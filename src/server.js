import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import protectedRoutes from "./routes/protected.js";
import authRoutes from "./routes/auth.js";
import { connectToDatabase } from "./mongo/connection.js";
import voiceRoutes from "./routes/voice.js";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Bootstrapped Express server with CORS, JSON parsing, and health endpoint.
 * - Mounted auth and protected routes with Firebase Admin verification.
 * - Added centralized error handling.
 * Why: Backend API needed for auth and role-protected access.
 * Related: `src/config/firebaseAdmin.js`, `src/middleware/auth.js`, `src/middleware/roles.js`.
 */

// Load environment variables early
dotenv.config();

const app = express();

// --- Global Middleware ---
app.use(cors());
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
  // Log once; keep response concise
  // NOTE: In production, prefer a structured logger
  console.error("Unhandled Error:", err);
  res.status(err.statusCode || 500).json({
    error: err.message || "Internal Server Error",
  });
});

// --- Server Startup ---
const PORT = process.env.PORT || 8000;

// Attempt DB connect (safe no-op if missing). Start server regardless.
await connectToDatabase();

app.listen(PORT, () => {
  console.log(`Selltron server running on port ${PORT}`);
});


