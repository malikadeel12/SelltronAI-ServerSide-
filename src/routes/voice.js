import { Router } from "express";
import multer from "multer";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Adds dummy Voice Pipeline endpoints: STT -> GPT -> TTS and a combined pipeline.
 * - Why: Unblocks Cockpit integration now; real providers (Google STT/TTS, GPT-4) can be swapped later.
 * - Related: Client Cockpit UI (`client/src/pages/Cockpit/PredatorDashboard.jsx`) and API helper.
 * - Business Logic: Modes 'sales' and 'support' apply different response tones.
 */

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// --- Config: available voices and modes ---
router.get("/config", (req, res) => {
  return res.json({
    voices: [
      { id: "voice_1", label: "Voice 1" },
      { id: "voice_2", label: "Voice 2" },
    ],
    modes: ["sales", "support"],
    notes: "Dummy config; replace with Google TTS voices list and app modes.",
  });
});

// --- Step 1: STT (Dummy) ---
// Accepts optional audio blob; returns a placeholder transcript.
router.post("/stt", upload.single("audio"), async (req, res) => {
  // NOTE: In production, forward audio buffer to Google STT for transcription.
  const language = req.body?.language || "en";
  const transcript = `Dummy transcript (${language}): customer said hello about pricing.`;
  return res.json({ transcript });
});

// --- Step 2: GPT Response (Dummy) ---
router.post("/gpt", async (req, res) => {
  // NOTE: In production, forward transcript+context to GPT-4.
  const { transcript, mode = "sales" } = req.body || {};
  const politePrefix = mode === "support" ? "I'm here to help." : "Great question!";
  const responseText = `${politePrefix} Based on: "${transcript || "(no transcript)"}", here's a helpful reply (dummy).`;
  return res.json({ responseText, mode });
});

// --- Step 3: TTS (Dummy) ---
router.post("/tts", async (req, res) => {
  // NOTE: In production, send text to Google Cloud TTS and return audio URL or stream.
  const { text, voice = "voice_1" } = req.body || {};
  // For dummy, we do not send actual audio bytes to avoid large payloads.
  return res.json({ audioUrl: null, voice, note: "Dummy TTS. Use client SpeechSynthesis as a placeholder." });
});

// --- Combined Pipeline (Dummy) ---
// Accepts audio + preferences and returns transcript, AI text, and a placeholder audio url.
router.post("/pipeline", upload.single("audio"), async (req, res) => {
  const { mode = "sales", voice = "voice_1", language = "en" } = req.body || {};

  // --- Validation Step ---
  // Minimal validation; in production, validate file type/size and required params.

  // --- STT ---
  const transcript = `Dummy transcript (${language}): customer asked for a discount.`;

  // --- GPT ---
  const politePrefix = mode === "support" ? "I understand your concern." : "Thanks for your interest!";
  const responseText = `${politePrefix} We can walk through options to get you the best value.`;

  // --- TTS ---
  // Return null to signal client to use browser TTS for now.
  const audioUrl = null;

  // --- Response ---
  return res.json({ transcript, responseText, audioUrl, meta: { mode, voice } });
});

export default router;


