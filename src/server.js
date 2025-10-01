import express from "express";
import cors from "cors";
import dotenv from "dotenv";
// Import routes conditionally to avoid Firebase errors
let protectedRoutes, authRoutes, voiceRoutes;

try {
  protectedRoutes = (await import("./routes/protected.js")).default;
  authRoutes = (await import("./routes/auth.js")).default;
  voiceRoutes = (await import("./routes/voice.js")).default;
} catch (error) {
  console.error("Route import error:", error);
  // Create dummy routes for testing
  protectedRoutes = (req, res) => res.status(200).json({ message: "Protected route" });
  authRoutes = (req, res) => res.status(200).json({ message: "Auth route" });
  voiceRoutes = (req, res) => res.status(200).json({ message: "Voice route" });
}
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
  res.status(200).json({ 
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development"
  });
});

// --- Debug Endpoint ---
app.get("/debug", (req, res) => {
  res.status(200).json({
    nodeEnv: process.env.NODE_ENV,
    vercel: process.env.VERCEL,
    mongoUri: process.env.MONGO_URI ? "Set" : "Not set",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ? "Set" : "Not set",
    openaiKey: process.env.OPENAI_API_KEY ? "Set" : "Not set",
    timestamp: new Date().toISOString()
  });
});

// --- Simple Test Endpoint ---
app.get("/test", (req, res) => {
  res.status(200).json({ 
    message: "Server is working!",
    timestamp: new Date().toISOString()
  });
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
try {
  const { connectToDatabase } = await import("./mongo/connection.js");
  await connectToDatabase();
} catch (error) {
  console.error("Database connection error:", error);
}

// Start server for local development (only if not in Vercel)
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Selltron server running on port ${PORT}`);
  });
}

// Export for Vercel serverless functions (always export)
export default app;


