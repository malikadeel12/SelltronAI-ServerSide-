import mongoose from "mongoose";
let isConnected = false;

// --- Mongo Connection (Safe) ---
export async function connectToDatabase() {
  const mongoUri = process.env.MONGO_URI;

  // Early exit if no URI provided; keep app running for local/dummy mode
  if (!mongoUri) {
    console.warn("MongoDB: MONGO_URI not set. Skipping DB connection (dummy mode).");
    return;
  }

  if (isConnected) {
    return;
  }

  try {
    // Use recommended options for stable connection
    await mongoose.connect(mongoUri, {
      autoIndex: true,
    });
    isConnected = true;
    console.log("MongoDB: Connected successfully");
  } catch (err) {
    // Do not crash app; log and continue in dummy mode
    console.error("MongoDB: Connection failed ->", err.message);
  }
}


