const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const { twilio: twilioConfig, deepgram: deepgramConfig } = require("./config");
const EventEmitter = require("events");
const bodyParser = require("body-parser");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let mediaStream;
let textToSpeech;
let streamSid;

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

app.post("/", (req, res) => {
  log("POST TwiML");

  const filePath = path.join(__dirname, "templates", "streams.xml");
  const stat = fs.statSync(filePath);

  res.writeHead(200, {
    "Content-Type": "text/xml",
    "Content-Length": stat.size,
  });

  const readStream = fs.createReadStream(filePath);
  readStream.pipe(res);
});

wss.on("connection", (ws) => {
  log("From Twilio: Connection accepted");
  mediaStream = new MediaStream(ws);
  textToSpeech = new TextToSpeech();
  textToSpeech.on("speech", (audio, text) => {
    console.log("In text to speech event");
    mediaStream.repeat(streamSid, audio);
  });
});

class MediaStream {
  constructor(connection) {
    this.connection = connection;
    this.connection.on("message", this.processMessage.bind(this));
    this.connection.on("close", this.close.bind(this));
    this.hasSeenMedia = false;
  }

  processMessage(message) {
    const data = JSON.parse(message);
    if (data.event === "connected") {
      log("From Twilio: Connected event received:", data);
    }
    if (data.event === "start") {
      log("From Twilio: Start event received:", data);
    }
    if (data.event === "media") {
      streamSid = data.streamSid;
      // Send media to Deepgram for transcription
      const audioBuffer = Buffer.from(data.media.payload, "base64");
      if (isDeepgramReady) {
        dg_ws.send(audioBuffer);
      } else {
        console.error("WebSocket to Deepgram is not ready yet.");
      }
    }
    if (data.event === "mark") {
      // log("From Twilio: Mark event received", data);
    }
    if (data.event === "close") {
      log("From Twilio: Close event received:", data);
      this.close();
    }
  }

  repeat(streamSid, audio) {
    const message = {
      event: "media",
      streamSid: streamSid,
      media: {
        payload: audio,
      },
    };
    const messageJSON = JSON.stringify(message);
    this.connection.send(messageJSON);

    // Send a mark message
    const markMessage = {
      event: "mark",
      streamSid,
      mark: {
        name: `Repeat message ${this.repeatCount}`,
      },
    };
    // log("To Twilio: Sending mark event", markMessage);
    this.connection.send(JSON.stringify(markMessage));
  }

  close() {
    log("Server: Closed");
  }
}

class TextToSpeech extends EventEmitter {
  constructor() {
    super();
    this.apiKey = deepgramConfig.apiKey; // Using the same API key for simplicity
    this.url =
      "https://api.deepgram.com/v1/speak?model=aura-luna-en&encoding=mulaw&sample_rate=8000&container=none"; // Update if needed
  }

  async synthesisAudio(speechToTextResponse) {
    console.log("In speechToTextResponse process");
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          Authorization: `Token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: speechToTextResponse,
        }),
      });

      if (response.status === 200) {
        try {
          const blob = await response.blob();
          const audioArrayBuffer = await blob.arrayBuffer();
          const base64String = Buffer.from(audioArrayBuffer).toString("base64");
          this.emit("speech", base64String, speechToTextResponse);
        } catch (err) {
          console.log(err);
        }
      } else {
        console.log("Deepgram TTS error:");
        console.log(response);
      }
    } catch (err) {
      console.error("Error occurred in TextToSpeech service");
      console.error(err);
    }
  }
}

const authToken = deepgramConfig.apiKey;
const headers = {
  Authorization: `Token ${authToken}`,
};
let isDeepgramReady = false;

INTERIM_RESULTS = false;
ENCODING_VALUE = "mulaw";
SAMPLE_RATE_VALUE = 8000;
SMART_FORMAT = true;
MODEL = "nova-2-general";
CHANNELS = 1;
const dg_ws = new WebSocket(
  `wss://api.deepgram.com/v1/listen?model=${MODEL}&interim_results=${INTERIM_RESULTS}&encoding=${ENCODING_VALUE}&sample_rate=${SAMPLE_RATE_VALUE}&smart_format=${SMART_FORMAT}&channels=${CHANNELS}`,
  { headers }
);
dg_ws.on("open", function open() {
  console.log("WebSocket connection established with Deepgram");
  isDeepgramReady = true;
  // Send KeepAlive messages every 3 seconds
  setInterval(() => {
    const keepAliveMsg = JSON.stringify({ type: "KeepAlive" });
    dg_ws.send(keepAliveMsg);
    console.log("Sent KeepAlive message");
  }, 3000);
});

dg_ws.on("message", async function incoming(data) {
  // Handle received data (transcription results, errors, etc.)
  console.log("------------------------------------------------");
  // Parse the received data into a JavaScript object
  const response = JSON.parse(data);

  // Check if the response contains a transcription result
  if (
    response.channel &&
    response.channel.alternatives &&
    response.channel.alternatives.length > 0
  ) {
    // Extract the transcript from the response
    const transcript = response.channel.alternatives[0].transcript;

    textToBeProcessed = "";
    if (transcript != "") {
      // Display the transcript
      console.log("Transcript:", transcript);
      console.log("------------------------------------------------");
      /**
       * send to deepgram text to speech api and get the audio buffer
       */
      try {
        console.log("In transcription process");
        await textToSpeech.synthesisAudio(transcript);
      } catch (error) {
        console.error("Error generating speech:", error);
      }
      // textToBeProcessed += transcript;
    }
  }
});

dg_ws.on("close", function close() {
  console.log("WebSocket connection closed with Deepgram");
  isDeepgramReady = false;
});

dg_ws.on("error", function error(err) {
  console.error("WebSocket error:", err.message);
});

const twilio = require("twilio");
const accountSid = twilioConfig.accountSid; // Replace with your Account SID
const twilioAuthToken = twilioConfig.authToken; // Replace with your Auth Token
const client = twilio(accountSid, twilioAuthToken);

app.post("/makeCall", (req, res) => {
  const toNumber = req.body.to; // The number you want to call
  const fromNumber = twilioConfig.twilioNumber; // Replace with your Twilio number

  client.calls
    .create({
      to: toNumber,
      from: fromNumber,
      url: "https://8915-58-84-60-228.ngrok-free.app", // You can provide your own TwiML URL here
    })
    .then((call) => {
      console.log(`Call initiated with SID: ${call.sid}`);
      res.status(200).send(`Call initiated with SID: ${call.sid}`);
    })
    .catch((error) => {
      console.error(`Failed to initiate call: ${error}`);
      res.status(500).send(`Failed to initiate call: ${error}`);
    });
});

const HTTP_SERVER_PORT = 8080;

server.listen(HTTP_SERVER_PORT, () => {
  console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`);
});
