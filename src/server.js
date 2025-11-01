import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import protectedRoutes from "./routes/protected.js";
import authRoutes from "./routes/auth.js";
import { connectToDatabase } from "./mongo/connection.js";
import voiceRoutes, { speechClient } from "./routes/voice.js";
import dns from "dns";

dns.setDefaultResultOrder("ipv4first");

// --- Load env from .env.local first, fallback to .env ---
dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const server = http.createServer(app);

// --- Allowed Frontend Domains ---
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "https://selltron-ai-clientsite.vercel.app",
];

// --- Global Middleware ---
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) callback(null, true);
      else callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

// --- Routes ---
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/protected", protectedRoutes);
app.use("/api/voice", voiceRoutes);

// --- Error Handler ---
app.use((err, req, res, next) => {
  console.error("❌ Error:", err.message);
  res.status(err.statusCode || 500).json({ error: err.message });
});

// --- Server Port ---
const PORT = process.env.PORT || 7000;

// --- Connect DB ---
await connectToDatabase();

// --- WebSocket for STT ---
const wss = new WebSocketServer({
  noServer: true,
  path: "/ws/voice/stt",
  perMessageDeflate: false,
});

wss.on("connection", (ws, req) => {
  ws.binaryType = "arraybuffer";

  console.log("🎤 BACKEND: WebSocket STT connection established");

  let recognizeStream = null;
  let configReceived = false;

  // --- Keep alive ---
  const keepAlive = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 20000);

  ws.on("message", async (message, isBinary) => {
    try {
      // 🧩 Step 1: If JSON, handle config or end
      if (!isBinary) {
        const payload = JSON.parse(message.toString());

        if (payload?.type === "config" && !configReceived) {
          configReceived = true;
          console.log("🎤 BACKEND: Received config:", payload.streamingConfig);

          const { encoding, sampleRateHertz, languageCode } =
            payload.streamingConfig.config || {};

          const request = {
            config: {
              encoding: encoding || "WEBM_OPUS",
              sampleRateHertz: sampleRateHertz || 48000,
              languageCode: languageCode || "en-US",
              enableAutomaticPunctuation: true,
              enableWordTimeOffsets: true,
              enableWordConfidence: true,
              model: "latest_long",
              useEnhanced: true,
              audioChannelCount: 1,
            },
            interimResults: true,
          };

          recognizeStream = speechClient
            .streamingRecognize(request)
            .on("error", (err) => {
              console.error("🎤 BACKEND: Google STT error:", err.message);
              ws.send(JSON.stringify({ type: "error", message: err.message }));
              try {
                ws.close();
              } catch (_) { }
            })
            .on("data", (data) => {
              const result = data.results?.[0];
              const transcript = result?.alternatives?.[0]?.transcript || "";
              const isFinal = !!result?.isFinal;
              if (transcript)
                ws.send(
                  JSON.stringify({ type: "transcript", transcript, isFinal })
                );
            });

          // Send ready signal to frontend
          ws.send(JSON.stringify({ type: "ready" }));
          console.log("🎤 BACKEND: Ready signal sent to frontend ✅");
          return;
        }

        if (payload?.type === "end") {
          console.log("🎤 BACKEND: Received end signal, closing stream");
          recognizeStream?.end();
          return;
        }
      }

      // 🎧 Step 2: Handle binary audio
      if (isBinary && recognizeStream) {
        recognizeStream.write(message);
      }
    } catch (err) {
      console.error("🎤 BACKEND: Message error:", err.message);
    }
  });

  ws.on("close", () => {
    clearInterval(keepAlive);
    console.log("🎤 BACKEND: WebSocket closed");
    try {
      recognizeStream?.end();
    } catch (_) { }
  });
});

// --- Handle Upgrade ---
server.on("upgrade", (req, socket, head) => {
  if (req.url.startsWith("/ws/voice/stt")) {
    console.log("⚙️ Upgrade request received at:", req.url);
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req)
    );
  } else {
    socket.destroy();
  }
});

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`🚀 Selltron server running on port ${PORT}`);
});
