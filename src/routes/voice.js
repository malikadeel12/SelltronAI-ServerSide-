import { Router } from "express";
import multer from "multer";
import { SpeechClient } from "@google-cloud/speech";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import OpenAI from "openai";
import fs from "fs";   // <-- yeh add karo
import salesQAService from "../services/salesQAService.js";

// --- Helper function to extract user question from frontend prompt ---
function extractUserQuestion(transcript) {
  // The frontend sends: "Customer said: "question". SALES MODE INSTRUCTIONS: ..."
  // We need to extract just the question part
  
  // Look for the pattern: Customer said: "question"
  const match = transcript.match(/Customer said:\s*"([^"]+)"/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  // Fallback: if no match found, return the original transcript
  console.log("⚠️ Could not extract user question from prompt, using original transcript");
  return transcript;
}

// --- Decode Base64 Google Key (if provided) ---
if (process.env.GOOGLE_CLOUD_KEY_BASE64) {
  try {
    const decoded = Buffer.from(process.env.GOOGLE_CLOUD_KEY_BASE64, "base64").toString("utf8");
    fs.writeFileSync("/tmp/gcloud-key.json", decoded);  // temporary file banayi
    process.env.GOOGLE_CLOUD_KEY_FILE = "/tmp/gcloud-key.json"; // env me set kiya
    console.log("✅ Google Cloud key decoded and written to /tmp/gcloud-key.json");
  } catch (err) {
    console.error("❌ Failed to decode GOOGLE_CLOUD_KEY_BASE64:", err.message);
  }
}
// Initialize Google Cloud clients
const speechClient = new SpeechClient({
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

const ttsClient = new TextToSpeechClient({
  keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
  projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
});

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Central list of valid Google TTS voice names (must match your project/region availability)
const VALID_VOICES = [
  { id: "en-US-Wavenet-A", label: "Male Voice (Wavenet A)" },
  { id: "en-US-Wavenet-B", label: "Male Voice (Wavenet B)" },
  { id: "en-US-Wavenet-C", label: "Female Voice (Wavenet C)" },
  { id: "en-US-Wavenet-D", label: "Male Voice (Wavenet D)" },
  { id: "en-US-Wavenet-E", label: "Female Voice (Wavenet E)" },
  { id: "en-US-Wavenet-F", label: "Female Voice (Wavenet F)" },
  { id: "en-US-Standard-A", label: "Male Voice (Standard A)" },
  { id: "en-US-Standard-B", label: "Male Voice (Standard B)" },
  { id: "en-US-Standard-C", label: "Female Voice (Standard C)" },
  { id: "en-US-Standard-D", label: "Male Voice (Standard D)" },
];

const DEFAULT_VOICE = "en-US-Wavenet-D";

function normalizeVoice(voice) {
  const incoming = (voice || "").trim();
  const exists = VALID_VOICES.some(v => v.id === incoming);
  return exists ? incoming : DEFAULT_VOICE;
}

// --- Config: available voices and modes ---
router.get("/config", (req, res) => {
  return res.json({
    voices: VALID_VOICES,
    modes: ["sales", "support"],
    languages: ["en-US", "es-ES", "fr-FR", "de-DE"],
    notes: "Real Google Cloud TTS voices and supported languages.",
  });
});

// --- Sales Q&A Statistics ---
router.get("/salesqa/stats", async (req, res) => {
  try {
    const questionCount = await salesQAService.getQuestionCount();
    const categories = await salesQAService.getAllCategories();
    
    return res.json({
      totalQuestions: questionCount,
      totalCategories: categories.length,
      categories: categories.map(cat => ({
        name: cat.category,
        description: cat.description,
        questionCount: cat.questions.length
      })),
      success: true
    });
  } catch (error) {
    console.error('SalesQA Stats Error:', error);
    return res.status(500).json({ error: "Failed to get sales Q&A statistics" });
  }
});

// --- Step 1: STT (Real Google Cloud Speech-to-Text) ---
router.post("/stt", upload.single("audio"), async (req, res) => {
  try {
    const language = req.body?.language || "en-US";
    // Optional accuracy tuners
    const sttModel = req.body?.sttModel || 'latest_long';
    let hints = [];
    if (Array.isArray(req.body?.hints)) {
      hints = req.body.hints;
    } else if (typeof req.body?.hints === 'string' && req.body.hints.trim()) {
      try { hints = JSON.parse(req.body.hints); } catch (_) { hints = req.body.hints.split(',').map(s => s.trim()).filter(Boolean); }
    }
    const boost = Number(req.body?.boost) || 15.0;
    // Detect encoding: prefer client-provided hint, else infer from mimetype
    let encoding = (req.body?.encoding || "").toUpperCase();
    const mime = req.file?.mimetype || "";
    if (!encoding) {
      if (mime.includes("ogg")) encoding = "OGG_OPUS";
      else if (mime.includes("webm")) encoding = "WEBM_OPUS";
      else if (mime.includes("wav")) encoding = "LINEAR16";
      else encoding = "WEBM_OPUS"; // default
    }
    console.log("🎯 SERVER: STT chosen encoding:", encoding, "mimetype:", mime);
    
    if (!req.file) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    const audioBytes = req.file.buffer.toString('base64');
    
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding,
        sampleRateHertz: 48000,
        languageCode: language,
        alternativeLanguageCodes: ['en-US', 'es-ES', 'fr-FR', 'de-DE'],
        enableAutomaticPunctuation: true,
        model: sttModel,
        // Speech adaptation: phrase hints to bias specific words/phrases
        speechContexts: hints.length ? [{ phrases: hints, boost }] : undefined,
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcript = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');

    return res.json({ transcript: transcript || "No speech detected" });
  } catch (error) {
    console.error('STT Error:', error);
    return res.status(500).json({ error: "Speech-to-text conversion failed" });
  }
});

// --- Step 2: GPT Response (Real OpenAI API) ---
router.post("/gpt", async (req, res) => {
  try {
    const { transcript, mode = "sales" } = req.body || {};
    
    if (!transcript) {
      return res.status(400).json({ error: "No transcript provided" });
    }

    let responseText = "";
    let matchedQuestion = null;

    // For sales mode, first search MongoDB for matching questions
    if (mode === "sales") {
      console.log("🔍 Searching for matching question in sales database...");
      
      // Extract just the user's question from the frontend's prompt
      const userQuestion = extractUserQuestion(transcript);
      console.log("🎯 Extracted user question:", userQuestion);
      
      matchedQuestion = await salesQAService.findMatchingQuestion(userQuestion);
      
      if (matchedQuestion) {
        console.log("✅ Found matching question:", matchedQuestion.question);
        
        // Create a prompt for GPT to analyze the 3 responses and return them in a specific format
        const systemPrompt = `You are a professional sales assistant. You have been given a customer question and 3 possible responses (A, B, C). 
        Your task is to analyze the customer's question and return the 3 responses in the following format:
        
        Response A: [first response]
        Response B: [second response] 
        Response C: [third response]
        
        Return ONLY the 3 responses in this exact format without any additional explanation or formatting.`;

        const userPrompt = `Customer Question: "${transcript}"
        
Matched Question: "${matchedQuestion.question}"

Available Responses:
A) ${matchedQuestion.answers[0].text}
B) ${matchedQuestion.answers[1].text}
C) ${matchedQuestion.answers[2].text}

Return the 3 responses in the specified format:`;

        try {
          const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            max_tokens: 300,
            temperature: 0.3, // Lower temperature for more consistent selection
          });

          responseText = completion.choices[0].message.content.trim();
          console.log("🤖 GPT analyzed and returned 3 responses:", responseText);
        } catch (gptError) {
          console.error('GPT Error in sales mode:', gptError);
          // Fallback to returning the 3 original responses
          responseText = `Response A: ${matchedQuestion.answers[0].text}\nResponse B: ${matchedQuestion.answers[1].text}\nResponse C: ${matchedQuestion.answers[2].text}`;
        }
      } else {
        // No matching question found, use general sales response
        console.log("❌ No matching question found, using general sales response");
        const systemPrompt = "You are a professional sales assistant. Be persuasive, knowledgeable about products, and help close deals while being helpful and friendly.";
        const userPrompt = `Customer said: "${transcript}". Please provide a helpful response that addresses their needs. Keep it concise and professional.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 200,
          temperature: 0.7,
        });

        responseText = completion.choices[0].message.content;
      }
    } else {
      // For support mode, use original logic
      const systemPrompt = "You are a helpful customer support assistant. Be empathetic, understanding, and provide clear solutions to customer problems.";
      const userPrompt = `Customer said: "${transcript}". Please provide a helpful response that addresses their needs. Keep it concise and professional.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 200,
        temperature: 0.7,
      });

      responseText = completion.choices[0].message.content;
    }

    return res.json({ 
      responseText, 
      mode,
      matchedQuestion: matchedQuestion ? {
        question: matchedQuestion.question,
        category: matchedQuestion.category
      } : null
    });
  } catch (error) {
    console.error('GPT Error:', error);
    return res.status(500).json({ error: "AI response generation failed" });
  }
});

// --- Step 3: TTS (Real Google Cloud Text-to-Speech) ---
router.post("/tts", async (req, res) => {
  try {
    const { text } = req.body || {};
    const voiceRaw = (req.body && req.body.voice) || DEFAULT_VOICE;
    const voice = normalizeVoice(voiceRaw);
    
    if (!text) {
      return res.status(400).json({ error: "No text provided for TTS" });
    }

    const request = {
      input: { text: text },
      voice: {
        languageCode: 'en-US',
        name: voice,
        ssmlGender: 'NEUTRAL',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: 1.0,
        pitch: 0.0,
      },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    const audioContent = response.audioContent;
    
    // Convert audio to base64 for transmission
    const audioBase64 = audioContent.toString('base64');
    
    return res.json({ 
      audioUrl: `data:audio/mp3;base64,${audioBase64}`,
      voice,
      success: true
    });
  } catch (error) {
    console.error('TTS Error:', error);
    return res.status(500).json({ error: "Text-to-speech conversion failed" });
  }
});

// --- Combined Pipeline (Real APIs) ---
router.post("/pipeline", upload.single("audio"), async (req, res) => {
  console.log("🚀 SERVER: Voice pipeline request received");
  try {
    const { mode = "sales", language = "en-US" } = req.body || {};
    const voice = normalizeVoice(req.body?.voice || DEFAULT_VOICE);
    console.log("📋 SERVER: Pipeline params:", { mode, voice, language });

    // --- Validation Step ---
    if (!req.file) {
      console.log("❌ SERVER: No audio file provided");
      return res.status(400).json({ error: "No audio file provided" });
    }
    
    console.log("📦 SERVER: Audio file received:", {
      size: req.file.size,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    });

    let transcript = "";
    let responseText = "";
    let audioUrl = null;

    // --- STT ---
    try {
      console.log("🎯 SERVER: Starting STT (Speech-to-Text)...");
      const audioBytes = req.file.buffer.toString('base64');
      // Detect encoding: prefer client-provided hint, else infer from mimetype
      let encoding = (req.body?.encoding || "").toUpperCase();
      const mime = req.file?.mimetype || "";
      if (!encoding) {
        if (mime.includes("ogg")) encoding = "OGG_OPUS";
        else if (mime.includes("webm")) encoding = "WEBM_OPUS";
        else if (mime.includes("wav")) encoding = "LINEAR16";
        else encoding = "WEBM_OPUS";
      }
      // Optional accuracy tuners
      const sttModel = req.body?.sttModel || 'latest_long';
      let hints = [];
      if (Array.isArray(req.body?.hints)) {
        hints = req.body.hints;
      } else if (typeof req.body?.hints === 'string' && req.body.hints.trim()) {
        try { hints = JSON.parse(req.body.hints); } catch (_) { hints = req.body.hints.split(',').map(s => s.trim()).filter(Boolean); }
      }
      const boost = Number(req.body?.boost) || 15.0;

      const sttRequest = {
        audio: { content: audioBytes },
        config: {
          encoding,
          sampleRateHertz: 48000,
          languageCode: language,
          enableAutomaticPunctuation: true,
          model: sttModel,
          enableWordTimeOffsets: false,
          enableWordConfidence: false,
          // Speech adaptation: phrase hints to bias specific words/phrases
          speechContexts: hints.length ? [{ phrases: hints, boost }] : undefined,
        },
      };
      console.log("🎯 SERVER: STT request config:", sttRequest.config, "mimetype:", mime);
      console.log("🎯 SERVER: Audio data size:", audioBytes.length, "characters");
      const [sttResponse] = await speechClient.recognize(sttRequest);
      console.log("🎯 SERVER: STT raw response:", JSON.stringify(sttResponse, null, 2));
      transcript = sttResponse.results
        .map(result => result.alternatives[0].transcript)
        .join('\n') || "No speech detected";
      console.log("🎯 SERVER: STT result:", transcript);
    } catch (sttError) {
      console.error('❌ SERVER: STT Error in pipeline:', sttError);
      console.error('❌ SERVER: STT Error details:', {
        message: sttError.message,
        code: sttError.code,
        details: sttError.details
      });
      
      // Fallback: Return a message indicating STT is not available
      transcript = "Google Cloud Speech-to-Text is not configured. Please enable the API and check your credentials.";
    }

    // --- GPT ---
    try {
      console.log("🤖 SERVER: Starting GPT response generation...");
      let matchedQuestion = null;

      // For sales mode, first search MongoDB for matching questions
      if (mode === "sales") {
        console.log("🔍 SERVER: Searching for matching question in sales database...");
        
        // Extract just the user's question from the frontend's prompt
        const userQuestion = extractUserQuestion(transcript);
        console.log("🎯 SERVER: Extracted user question:", userQuestion);
        
        matchedQuestion = await salesQAService.findMatchingQuestion(userQuestion);
        
        if (matchedQuestion) {
          console.log("✅ SERVER: Found matching question:", matchedQuestion.question);
          
          // Create a prompt for GPT to analyze the 3 responses and return them in a specific format
          const systemPrompt = `You are a professional sales assistant. You have been given a customer question and 3 possible responses (A, B, C). 
          Your task is to analyze the customer's question and return the 3 responses in the following format:
          
          Response A: [first response]
          Response B: [second response] 
          Response C: [third response]
          
          Return ONLY the 3 responses in this exact format without any additional explanation or formatting.`;

          const userPrompt = `Customer Question: "${transcript}"
          
Matched Question: "${matchedQuestion.question}"

Available Responses:
A) ${matchedQuestion.answers[0].text}
B) ${matchedQuestion.answers[1].text}
C) ${matchedQuestion.answers[2].text}

Return the 3 responses in the specified format:`;

          try {
            const completion = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              max_tokens: 300,
              temperature: 0.3, // Lower temperature for more consistent selection
            });

            responseText = completion.choices[0].message.content.trim();
            console.log("🤖 SERVER: GPT analyzed and returned 3 responses:", responseText);
          } catch (gptError) {
            console.error('❌ SERVER: GPT Error in sales mode:', gptError);
            // Fallback to returning the 3 original responses
            responseText = `Response A: ${matchedQuestion.answers[0].text}\nResponse B: ${matchedQuestion.answers[1].text}\nResponse C: ${matchedQuestion.answers[2].text}`;
          }
        } else {
          // No matching question found, use general sales response
          console.log("❌ SERVER: No matching question found, using general sales response");
          const systemPrompt = "You are a professional sales assistant. Be persuasive and help close deals while being helpful.";
          const userPrompt = `Customer said: "${transcript}". Please provide a helpful response. Keep it concise and professional.`;

          const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            max_tokens: 200,
            temperature: 0.7,
          });

          responseText = completion.choices[0].message.content;
        }
      } else {
        // For support mode, use original logic
        const systemPrompt = "You are a helpful customer support assistant. Be empathetic and provide clear solutions.";
        const userPrompt = `Customer said: "${transcript}". Please provide a helpful response. Keep it concise and professional.`;

        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 200,
          temperature: 0.7,
        });

        responseText = completion.choices[0].message.content;
      }

      console.log("🤖 SERVER: GPT response:", responseText);
    } catch (gptError) {
      console.error('❌ SERVER: GPT Error in pipeline:', gptError);
      responseText = "AI response generation failed";
    }

    // --- TTS ---
    try {
      if (responseText) {
        console.log("🔊 SERVER: Starting TTS (Text-to-Speech)...");
        const ttsRequest = {
          input: { text: responseText },
          voice: {
            languageCode: 'en-US',
            name: voice,
            ssmlGender: 'NEUTRAL',
          },
          audioConfig: {
            audioEncoding: 'MP3',
            speakingRate: 1.0,
            pitch: 0.0,
          },
        };
        console.log("🔊 SERVER: TTS request config:", ttsRequest.voice);

        const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
        const audioContent = ttsResponse.audioContent;
        const audioBase64 = audioContent.toString('base64');
        audioUrl = `data:audio/mp3;base64,${audioBase64}`;
        console.log("🔊 SERVER: TTS audio generated successfully");
      }
    } catch (ttsError) {
      console.error('❌ SERVER: TTS Error in pipeline:', ttsError);
      console.log('⚠️ SERVER: TTS failed, will use browser TTS fallback');
      // Continue without TTS if it fails
    }

    // --- Response ---
    console.log("✅ SERVER: Voice pipeline completed successfully!");
    console.log("📤 SERVER: Sending response:", { 
      transcript: transcript.substring(0, 50) + "...", 
      responseText: responseText.substring(0, 50) + "...", 
      audioUrl: audioUrl ? "Available" : "Not available",
      meta: { mode, voice, language }
    });
    
    return res.json({ 
      transcript, 
      responseText, 
      audioUrl, 
      meta: { mode, voice, language },
      success: true
    });
  } catch (error) {
    console.error('❌ SERVER: Pipeline Error:', error);
    return res.status(500).json({ error: "Voice pipeline failed" });
  }
});

export default router;


