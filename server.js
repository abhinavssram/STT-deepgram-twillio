// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { twilio: twilioConfig, deepgram: deepgramConfig } = require("./config");

const app = express();
const server = http.createServer(app);
const our_wss = new WebSocket.Server({ server });

const authToken = deepgramConfig.apiKey;
const headers = {
  Authorization: `Token ${authToken}`,
};
let isDeepgramReady = false;

INTERIM_RESULTS = true;
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

dg_ws.on("message", function incoming(data) {
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

    // Display the transcript
    console.log("Transcript:", transcript);
  }
  console.log("------------------------------------------------");
});

dg_ws.on("close", function close() {
  console.log("WebSocket connection closed with Deepgram");
  isDeepgramReady = false;
});

dg_ws.on("error", function error(err) {
  console.error("WebSocket error:", err.message);
});

our_wss.on("connection", (ws) => {
  console.log("Websocket connection initiated");

  ws.on("message", (message) => {
    const msg = JSON.parse(message);
    switch (msg.event) {
      case "connected":
        console.log("Twillio websocket is connected with the our server");
        break;
      case "start":
        console.log("Twillio start sending the msg");
        break;
      case "media":
        // console.log("Recieving the audio...");
        // Here you can start sending your raw audio data
        if (isDeepgramReady) {
          const audioBuffer = Buffer.from(msg.media.payload, "base64");
          dg_ws.send(audioBuffer);
        } else {
          console.error("WebSocket to Deepgram is not ready yet.");
        }
        break;
      case "stop":
        console.log("call ended ");
        break;
    }
  });
});

app.post("/", (req, res) => {
  res.type("text/xml");
  res.send(
    `<Response>
        <Say>
          Speak to see your audio transcribed in the console.
        </Say>
        <Connect>
          <Stream url='wss://${req.headers.host}' />
        </Connect>
      </Response>`
  );
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
