import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import protectedRoutes from "./routes/protected.js";
import authRoutes from "./routes/auth.js";
import { connectToDatabase } from "./mongo/connection.js";
import voiceRoutes from "./routes/voice.js";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
// Load env from .env.local first (user keeps keys there), then fallback to .env
dotenv.config({ path: ".env.local" });
dotenv.config();
const app = express();

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
  console.error("Unhandled Error:", err);
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// --- Server Startup ---
const PORT = process.env.PORT || 7000;

// Attempt DB connect (safe no-op if missing). Start server regardless.
await connectToDatabase();

app.listen(PORT, () => {
  console.log(`Selltron server running on port ${PORT}`);
});


