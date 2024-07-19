const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

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
  const mediaStream = new MediaStream(ws);
});

class MediaStream {
  constructor(connection) {
    this.connection = connection;
    this.connection.on("message", this.processMessage.bind(this));
    this.connection.on("close", this.close.bind(this));
    this.hasSeenMedia = false;
    this.messages = [];
    this.repeatCount = 0;
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
      if (!this.hasSeenMedia) {
        log("From Twilio: Media event received:", data);
        log("Server: Suppressing additional messages...");
        this.hasSeenMedia = true;
      }
      // Store media messages
      this.messages.push(data);
      log(`From Twilio: ${this.messages.length} omitted media messages`);
      this.repeat();
    }
    if (data.event === "mark") {
      log("From Twilio: Mark event received", data);
    }
    if (data.event === "close") {
      log("From Twilio: Close event received:", data);
      this.close();
    }
  }

  repeat() {
    const messages = [...this.messages];
    this.messages = [];
    const streamSid = messages[0].streamSid;

    // Decode each message and store the bytes in an array
    const messageByteBuffers = messages.map((msg) =>
      Buffer.from(msg.media.payload, "base64")
    );
    // Combine all the bytes, and then base64 encode the entire payload.
    const payload = Buffer.concat(messageByteBuffers).toString("base64");
    const message = {
      event: "media",
      streamSid,
      media: {
        payload,
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

const HTTP_SERVER_PORT = 8080;

server.listen(HTTP_SERVER_PORT, () => {
  console.log(`Server listening on: http://localhost:${HTTP_SERVER_PORT}`);
});
