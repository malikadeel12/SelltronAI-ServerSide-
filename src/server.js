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
// Load env from .env.local first (user keeps keys there), then fallback to .env
dotenv.config({ path: ".env.local" });
dotenv.config();
const app = express();
const server = http.createServer(app);

// --- Allowed Frontend Domains ---
const allowedOrigins = [
  "http://localhost:5173",     
      "http://localhost:5174", 
  "https://selltron-ai-clientsite.vercel.app",
   // tumhara deployed frontend (example)
];

// --- Global Middleware ---
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);
app.use(express.json());

// --- Health Check ---
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// --- Routes ---
app.use("/api/auth", authRoutes);
app.use("/api/protected", protectedRoutes);
app.use("/api/voice", voiceRoutes);

// --- Error Handler ---
app.use((err, req, res, next) => {
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// --- Server Startup ---
const PORT = process.env.PORT || 7000;

// Attempt DB connect (safe no-op if missing). Start server regardless.
await connectToDatabase();

// --- WebSocket for Streaming STT ---
const wss = new WebSocketServer({ server, path: "/ws/voice/stt" });

wss.on("connection", (ws, req) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const language = url.searchParams.get("language") || "en-US";
    const encoding = (url.searchParams.get("encoding") || "WEBM_OPUS").toUpperCase();
    const sampleRateHertz = parseInt(url.searchParams.get("sampleRateHertz") || "48000", 10);
    const hintsParam = url.searchParams.get("hints");
    let speechContexts = [];
    if (hintsParam) {
      try {
        const hints = JSON.parse(hintsParam);
        if (Array.isArray(hints) && hints.length > 0) {
          speechContexts = [{ phrases: hints, boost: 16.0 }];
        }
      } catch (_) {
      }
    }

    console.log('🎤 BACKEND: WebSocket STT connection established:', { language, encoding, sampleRateHertz });

    const request = {
      config: {
        encoding,
        sampleRateHertz,
        languageCode: language,
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        model: "latest_long",
        useEnhanced: true,
        ...(speechContexts.length > 0 ? { speechContexts } : {}),
      },
      interimResults: true,
      singleUtterance: false,
    };

    const recognizeStream = speechClient
      .streamingRecognize(request)
      .on("error", (err) => {
        console.error('🎤 BACKEND: Google STT stream error:', err.message);
        try { ws.send(JSON.stringify({ type: "error", message: err.message })); } catch (_) {}
        try { ws.close(); } catch (_) {}
      })
      .on("data", (data) => {
        const results = data.results || [];
        if (results.length === 0) return;
        const result = results[0];
        const alt = (result.alternatives && result.alternatives[0]) || {};
        const transcript = alt.transcript || "";
        const isFinal = !!result.isFinal;
        console.log('🎤 BACKEND: Google STT transcript:', transcript, 'isFinal:', isFinal);
        try {
          ws.send(JSON.stringify({ type: "transcript", transcript, isFinal }));
        } catch (_) {}
      });

    // Stream is ready to receive audio bytes
    try { 
      ws.send(JSON.stringify({ type: "ready" })); 
      console.log('🎤 BACKEND: WebSocket STT ready signal sent');
    } catch (_) {}

    ws.on("message", (message, isBinary) => {
      if (isBinary) {
        // Write raw audio bytes to the stream
        recognizeStream.write(message);
      } else {
        // Optionally handle control messages
        try {
          const payload = JSON.parse(message.toString());
          if (payload && payload.type === "end") {
            console.log('🎤 BACKEND: Received end signal, closing stream');
            recognizeStream.end();
          }
        } catch (_) {}
      }
    });

    ws.on("close", () => {
      console.log('🎤 BACKEND: WebSocket STT connection closed');
      try { recognizeStream.end(); } catch (_) {}
    });
  } catch (err) {
    console.error('🎤 BACKEND: WebSocket setup error:', err.message);
    try { ws.send(JSON.stringify({ type: "error", message: err.message })); } catch (_) {}
    try { ws.close(); } catch (_) {}
  }
});
server.on('upgrade', (req, socket, head) => {
  console.log('⚙️ Upgrade request received at:', req.url);
});


server.listen(PORT, () => {
  console.log(`Selltron server running on port ${PORT}`);
});