import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { SpeechClient } from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import OpenAI from "openai";
import fs from "fs";
import salesQAService from "../services/salesQAService.js";
import { extractUserQuestion, detectKeyHighlights } from "../services/keyHighlightsService.js";
import { extractCustomerInfoFromTranscript } from "../services/crmService.js";
import { getContactByEmail, upsertHubspotContact, createCustomProperties, updateContactWithKeyHighlights, updateContactWithSentiment } from "../services/hubspotService.js";
import { analyzeSentiment } from "../services/sentimentService.js";
import { Client as Hubspot } from "@hubspot/api-client";

// --- Helper function to parse multiple questions from user input ---
function parseMultipleQuestions(userInput) {
  if (!userInput || typeof userInput !== 'string') {
    return [userInput];
  }

  const questions = [];
  const input = userInput.trim();

  // If input is very short, don't try to split it
  if (input.length < 30) {
    return [input];
  }

  // Common question separators in Urdu/English (more conservative)
  const separators = [
    /\?\s+(?=[A-Z])/g,           // Question mark followed by capital letter
    /\.\s+(?=[A-Z])/g,           // Period followed by capital letter
    /\sand\s+(?=[A-Z])/gi,       // "and" followed by capital letter
    /\saur\s+(?=[A-Z])/gi,       // "aur" followed by capital letter
    /;\s+/g,                     // Semicolon
    /\sand\s+(?=why|what|how|when|where|who|can|do|will|would|should)/gi  // "and" followed by question words
  ];

  let currentInput = input;
  let foundSeparator = false;

  // Try each separator
  for (const separator of separators) {
    const matches = currentInput.split(separator);
    if (matches.length > 1) {
      // Only split if each part is a meaningful question
      const validQuestions = matches.filter(match => {
        const trimmed = match.trim();
        return trimmed.length > 10 && (trimmed.includes('?') || trimmed.length > 20);
      });

      if (validQuestions.length > 1) {
        questions.push(...validQuestions);
        foundSeparator = true;
        break;
      }
    }
  }

  // If no separator found, check for multiple question words
  if (!foundSeparator) {
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'can', 'do', 'will', 'would', 'should', 'kya', 'kaise', 'kyun', 'kab', 'kahan', 'kaun'];
    const questionCount = questionWords.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      return count + (input.match(regex) || []).length;
    }, 0);

    // Only split if we have multiple complete questions (not fragments)
    if (questionCount > 1) {
      // Look for complete question patterns, not just question words
      const completeQuestionPattern = /(?:what|how|why|when|where|who|can|do|will|would|should|kya|kaise|kyun|kab|kahan|kaun)[^.!?]*(?:[.!?]|$)/gi;
      const matches = input.match(completeQuestionPattern);

      if (matches && matches.length > 1) {
        // Only add questions that are complete and meaningful
        matches.forEach(match => {
          const trimmed = match.trim();
          if (trimmed.length > 15 && trimmed.endsWith('?') || trimmed.length > 20) {
            questions.push(trimmed);
          }
        });
      }
    }
  }

  // If still no multiple questions found, return single question
  if (questions.length === 0) {
    questions.push(input);
  }

  console.log(`🔍 Parsed ${questions.length} question(s):`, questions);
  return questions;
}

// google cloud API setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultCredentialsPath = path.join(__dirname, "../apikey/google-key.json");
const inlineCreds = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;

let serviceAccount = null;
let projectId = null;
let credentialsFile = null;
if (fs.existsSync(defaultCredentialsPath)) {
  serviceAccount = JSON.parse(fs.readFileSync(defaultCredentialsPath, "utf8"));
  projectId = serviceAccount.project_id;
  credentialsFile = defaultCredentialsPath;
  console.log("✅ Using credentials from default path:", defaultCredentialsPath);
}
if (!serviceAccount && inlineCreds) {
  let jsonString = inlineCreds;
  try {
    jsonString = Buffer.from(inlineCreds, "base64").toString("utf8");
  } catch (_) {
  }
  serviceAccount = JSON.parse(jsonString);
  projectId = serviceAccount.project_id;
  const tempDir = process.platform === 'win32' ? process.env.TEMP || './temp' : '/tmp';
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const tempKeyFile = path.join(tempDir, 'gcloud-key.json');
  fs.writeFileSync(tempKeyFile, jsonString);
  credentialsFile = tempKeyFile;
  console.log("✅ Using credentials from environment variable (temp file)");
}

if (!serviceAccount || !credentialsFile) {
  throw new Error("Google Cloud credentials not found! Please set up service account key.");
}

// Set the credentials file path for Google Cloud SDK
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsFile;

console.log("🔑 Google Cloud Service Account Configuration:");
console.log(`   - Project ID: ${projectId}`);
console.log(`   - Credentials File: ${credentialsFile}`);
console.log(`   - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
console.log(`   - Service Account Email: ${serviceAccount.client_email}`);

// Let Google Cloud SDK automatically use GOOGLE_APPLICATION_CREDENTIALS
const speechClient = new SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();


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
  // German voices
  { id: "de-DE-Standard-A", label: "German Female Voice (Standard A)" },
  { id: "de-DE-Standard-B", label: "German Male Voice (Standard B)" },
  { id: "de-DE-Standard-C", label: "German Female Voice (Standard C)" },
  { id: "de-DE-Standard-D", label: "German Male Voice (Standard D)" },
  { id: "de-DE-Wavenet-A", label: "German Female Voice (Wavenet A)" },
  { id: "de-DE-Wavenet-B", label: "German Male Voice (Wavenet B)" },
  { id: "de-DE-Wavenet-C", label: "German Female Voice (Wavenet C)" },
  { id: "de-DE-Wavenet-D", label: "German Male Voice (Wavenet D)" },
];

const DEFAULT_VOICE = "en-US-Wavenet-D";
const DEFAULT_GERMAN_VOICE = "de-DE-Wavenet-B";

function normalizeVoice(voice, language = "en-US") {
  const incoming = (voice || "").trim();
  const exists = VALID_VOICES.some(v => v.id === incoming);
  if (exists) return incoming;
  
  // Return language-specific default
  return language === "de-DE" ? DEFAULT_GERMAN_VOICE : DEFAULT_VOICE;
}

// Helper function to get appropriate voice based on language
function getVoiceForLanguage(voice, language = "en-US") {
  const normalized = normalizeVoice(voice, language);
  
  // If voice doesn't match the language, get default voice for that language
  if (language === "de-DE" && !normalized.startsWith("de-DE")) {
    return DEFAULT_GERMAN_VOICE;
  } else if (language === "en-US" && !normalized.startsWith("en-US")) {
    return DEFAULT_VOICE;
  }
  
  return normalized;
}

// Helper function to add language instruction to GPT prompts
function addLanguageInstruction(prompt, language = "en-US") {
  if (language === "de-DE") {
    return prompt + "\n\nIMPORTANT: Respond ONLY in German. All responses must be in German language.";
  }
  return prompt;
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

// --- Clear Sales Q&A Cache ---
router.post("/salesqa/clear-cache", async (req, res) => {
  try {
    salesQAService.clearAllCache();
    return res.json({
      message: "Cache cleared successfully",
      success: true
    });
  } catch (error) {
    console.error('Clear Cache Error:', error);
    return res.status(500).json({ error: "Failed to clear cache" });
  }
});

// --- Step 2: GPT Response (Real OpenAI API) ---
router.post("/gpt", async (req, res) => {
  try {
    let { transcript, mode = "sales", conversationHistory = [], language = "en-US" } = req.body || {};
    
    // Ensure conversationHistory is an array
    if (!Array.isArray(conversationHistory)) {
      console.log("⚠️ conversationHistory is not an array in /gpt, converting...");
      try {
        if (typeof conversationHistory === 'string') {
          conversationHistory = JSON.parse(conversationHistory);
        }
        if (!Array.isArray(conversationHistory)) {
          conversationHistory = [];
        }
      } catch (e) {
        conversationHistory = [];
      }
    }

    if (!transcript) {
      return res.status(400).json({ error: "No transcript provided" });
    }

    let responseText = "";
    let matchedQuestion = null;

    // For sales mode, first search MongoDB for matching questions
    if (mode === "sales") {
      console.log("🔍 Searching for matching questions in sales database...");

      // Extract just the user's question from the frontend's prompt
      const userQuestion = extractUserQuestion(transcript);
      console.log("🎯 Extracted user question:", userQuestion);

      // Parse multiple questions from user input
      const questions = parseMultipleQuestions(userQuestion);
      console.log("🔍 Parsed questions:", questions);

      // Search for matches for all questions
      // First try normal search, if no good matches, try force search
      let matchedQuestions = await salesQAService.findMultipleMatchingQuestions(questions);

      // If no matches or low quality matches, try force search
      if (matchedQuestions.length === 0 || (matchedQuestions[0] && matchedQuestions[0].similarity < 0.6)) {
        console.log('🔄 No good matches found, trying force search...');
        const forceMatches = [];
        for (const query of questions) {
          const forceMatch = await salesQAService.findMatchingQuestionForce(query.trim());
          if (forceMatch) {
            forceMatches.push({
              originalQuery: query.trim(),
              matchedQuestion: forceMatch.question,
              answers: forceMatch.answers,
              category: forceMatch.category,
              description: forceMatch.description,
              similarity: forceMatch.similarity || 0
            });
          }
        }
        if (forceMatches.length > 0) {
          matchedQuestions = forceMatches;
          console.log(`🎯 Force search found ${forceMatches.length} better matches`);
        }
      }

      if (matchedQuestions.length > 0) {
        console.log(`✅ Found ${matchedQuestions.length} matching question(s):`, matchedQuestions.map(m => m.matchedQuestion));

        // Skip GPT call and use database responses directly for faster response
        console.log("⚡ Using direct database responses for faster processing");
        responseText = matchedQuestions.map((match, index) => {
          return `Response A: ${match.answers[0].text}\nResponse B: ${match.answers[1].text}\nResponse C: ${match.answers[2].text}`;
        }).join('\n\n');
        console.log("🎯 Direct database response generated:", responseText);
      } else {
        // No matching question found, find related questions for GPT context
        console.log("❌ No matching question found, finding related questions for GPT analysis");

        // Extract user question for related search
        const userQuestion = extractUserQuestion(transcript);
        const relatedQuestions = await salesQAService.findRelatedQuestionsForGPT(userQuestion);

        if (relatedQuestions.length > 0) {
          console.log(`🎯 Found ${relatedQuestions.length} related questions for GPT context`);

          // Create enhanced context from related questions
          const contextQuestions = relatedQuestions.map((q, index) =>
            `Example ${index + 1}:\nQ: ${q.question}\nA: ${q.answers[0].text}\nB: ${q.answers[1].text}\nC: ${q.answers[2].text}\nCategory: ${q.category}`
          ).join('\n\n');

          // Build conversation context for GPT
          let conversationContext = "";
          if (conversationHistory && conversationHistory.length > 0) {
            conversationContext = "\n\nCONVERSATION HISTORY:\n";
            conversationHistory.slice(-5).forEach((entry, index) => {
              conversationContext += `Previous ${index + 1}:\n`;
              conversationContext += `Customer: ${entry.userInput}\n`;
              conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
            });
            conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
          }

          let systemPrompt = `You are an expert sales assistant. You have access to a database of proven sales responses. 
          Here are some related sales scenarios and their successful responses:
          ${contextQuestions}
          ${conversationContext}
          
          Your task: Analyze the customer's question and provide 3 persuasive sales responses (A, B, C format) that are relevant to their specific concern. Use the context above to understand the sales approach and tone. Consider the conversation history to provide contextually relevant responses.`;

          systemPrompt = addLanguageInstruction(systemPrompt, language);

          let userPrompt = `Customer asked: "${userQuestion}". 
          Based on the sales context above and conversation history, provide 3 short, persuasive sales responses (A, B, C format) that directly address their question. Make sure each response is different and covers different angles of persuasion.`;
          
          userPrompt = addLanguageInstruction(userPrompt, language);

          const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            max_tokens: 250,
            temperature: 0.8,
          });

          responseText = completion.choices[0].message.content;
        } else {
          // No related questions found, use general sales response
          console.log("❌ No related questions found, using general sales response");

          // Build conversation context for general sales response
          let conversationContext = "";
          if (conversationHistory && conversationHistory.length > 0) {
            conversationContext = "\n\nCONVERSATION HISTORY:\n";
            conversationHistory.slice(-5).forEach((entry, index) => {
              conversationContext += `Previous ${index + 1}:\n`;
              conversationContext += `Customer: ${entry.userInput}\n`;
              conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
            });
            conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
          }

          let systemPrompt = `You are a sales assistant. Be persuasive and helpful. Keep responses short.${conversationContext}`;
          systemPrompt = addLanguageInstruction(systemPrompt, language);
          
          let userPrompt = `Customer: "${transcript}". Give 3 short sales responses (A, B, C format). Consider the conversation history to provide contextually relevant responses.`;
          userPrompt = addLanguageInstruction(userPrompt, language);

          const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            max_tokens: 200,
            temperature: 0.7,
          });

          responseText = completion.choices[0].message.content;
        }
      }
    } else {
      // For support mode, use original logic

      // Build conversation context for support mode
      let conversationContext = "";
      if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
        conversationContext = "\n\nCONVERSATION HISTORY:\n";
        conversationHistory.slice(-5).forEach((entry, index) => {
          conversationContext += `Previous ${index + 1}:\n`;
          conversationContext += `Customer: ${entry.userInput}\n`;
          conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
        });
        conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
      }

      let systemPrompt = `You are a helpful customer support assistant. Be empathetic, understanding, and provide clear solutions to customer problems.${conversationContext}`;
      systemPrompt = addLanguageInstruction(systemPrompt, language);
      
      let userPrompt = `Customer said: "${transcript}". Please provide a helpful response that addresses their needs. Keep it concise and professional. Consider the conversation history to provide contextually relevant responses.`;
      userPrompt = addLanguageInstruction(userPrompt, language);

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
  const { text, language = "en-US" } = req.body || {};
  const voiceRaw = (req.body && req.body.voice) || DEFAULT_VOICE;
  const voice = getVoiceForLanguage(voiceRaw, language);

  try {
    if (!text) {
      return res.status(400).json({ error: "No text provided for TTS" });
    }

    // Check if TTS client is available
    if (!ttsClient) {
      console.log('⚠️ TTS client not available');
      return res.status(500).json({
        error: "TTS service not configured - Google Cloud credentials are missing or invalid",
        fallback: true,
        message: "Please regenerate Google Cloud service account key and restart server"
      });
    }

    const request = {
      input: { text: text },
      voice: {
        languageCode: language,
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

    // Check for specific authentication errors
    if (error.code === 16 || error.message.includes('UNAUTHENTICATED') || error.message.includes('ACCESS_TOKEN_EXPIRED')) {
      console.log('🔑 Google Cloud authentication failed - check your service account key');
      console.log('💡 Current configuration:');
      console.log(`   - Key file: ${credentialsFile || 'Not found'}`);
      console.log(`   - Project ID: ${projectId || 'Not set'}`);
      console.log(`   - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'Not set'}`);
      console.log('🔧 Possible fixes:');
      console.log('   1. Enable Cloud Text-to-Speech API in Google Cloud Console');
      console.log('   2. Check billing is enabled for your project');
      console.log('   3. Verify service account has Text-to-Speech API permissions');
      console.log('   4. Ensure service account key file is valid and accessible');
      console.log('   5. System will use browser TTS as fallback');
    }

    console.log('⚠️ Google Cloud TTS failed, returning fallback response');
    // Return a response indicating TTS failed but the request was successful
    return res.json({
      audioUrl: null,
      voice: voiceRaw || DEFAULT_VOICE,
      success: false,
      error: "TTS service unavailable - will use browser TTS fallback",
      fallback: true
    });
  }
});

// --- Streaming STT for Live Transcription ---
router.post("/stt-stream", upload.single("audio"), async (req, res) => {
  console.log("🎤 SERVER: Streaming STT request received");
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    // Check if audio file is provided
    if (!req.file || !req.file.buffer) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'No audio file provided' })}\n\n`);
      res.end();
      return;
    }

    // Convert audio to proper format (raw bytes for streaming)
    const audioBytes = req.file.buffer;

    // Detect encoding
    let encoding = (req.body?.encoding || '').toUpperCase();
    const mime = req.file?.mimetype || '';
    if (!encoding) {
      if (mime.includes("ogg")) encoding = "OGG_OPUS";
      else if (mime.includes("webm")) encoding = "WEBM_OPUS";
      else if (mime.includes("wav")) encoding = "LINEAR16";
      else encoding = "WEBM_OPUS";
    }

    console.log("🎤 Starting streaming STT with interim results...");

    // Use non-streaming API for individual chunks (streaming API doesn't work with separate chunks)
    // Build speech context with hints if provided (for better accuracy)
    const hints = req.body?.hints || [];
    const boost = req.body?.boost || 16.0;
    const speechContexts = Array.isArray(hints) && hints.length > 0 ? [{
      phrases: hints,
      boost: parseFloat(boost) || 16.0
    }] : [];
    
    const request = {
      audio: { content: audioBytes.toString('base64') },
      config: {
        encoding,
        sampleRateHertz: 48000,
        languageCode: req.body.language || 'en-US',
        enableAutomaticPunctuation: true,
        model: 'latest_long',  // Use long model for 1-second chunks
        useEnhanced: true, // Use enhanced model for better accuracy
        enableWordConfidence: true, // Get confidence scores for words
        enableWordTimeOffsets: true, // Get word timing information
        ...(speechContexts.length > 0 ? { speechContexts } : {}),
      },
    };

    const [response] = await speechClient.recognize(request);
    const results = response.results || [];
    
    console.log('🔍 STT Results count:', results.length);
    
    if (results.length > 0) {
      const transcript = results[0].alternatives?.[0]?.transcript || '';
      console.log('📝 Transcript from STT:', transcript);
      
      if (transcript) {
        console.log('✅ Sending transcript to frontend:', transcript);
        res.write(`data: ${JSON.stringify({ 
          type: 'interim', 
          transcript, 
          isFinal: false 
        })}\n\n`);
      } else {
        console.log('⚠️ Transcript is empty');
      }
    } else {
      console.log('⚠️ No results from STT');
    }
    
    res.end();
    
  } catch (error) {
    console.error('❌ Streaming STT Error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// --- Combined Pipeline (Real APIs) ---
router.post("/pipeline", upload.single("audio"), async (req, res) => {
  console.log("🚀 SERVER: Voice pipeline request received");
  try {
    let { mode = "sales", language = "en-US", conversationHistory = [], hints = [], boost = 16 } = req.body || {};
    const voice = getVoiceForLanguage(req.body?.voice || DEFAULT_VOICE, language);
    
    // Parse hints if it's a JSON string
    if (typeof hints === 'string') {
      try {
        hints = JSON.parse(hints);
      } catch (e) {
        hints = [];
      }
    }
    if (!Array.isArray(hints)) {
      hints = [];
    }
    
    // Ensure conversationHistory is an array
    if (!Array.isArray(conversationHistory)) {
      console.log("⚠️ conversationHistory is not an array, converting...", typeof conversationHistory);
      try {
        // Try to parse if it's a JSON string
        if (typeof conversationHistory === 'string') {
          conversationHistory = JSON.parse(conversationHistory);
        }
        // If still not an array, set to empty array
        if (!Array.isArray(conversationHistory)) {
          conversationHistory = [];
        }
      } catch (e) {
        console.log("⚠️ Failed to parse conversationHistory, using empty array");
        conversationHistory = [];
      }
    }
    
    console.log("📋 SERVER: Pipeline params:", { mode, voice, language, conversationHistoryLength: conversationHistory.length, hintsCount: hints.length, boost });

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

    // Check if audio file is too small (likely empty or just noise)
    if (req.file.size < 1000) {
      console.log("⚠️ SERVER: Audio too small, skipping processing:", req.file.size);
      return res.status(200).json({
        transcript: "",
        responseText: "",
        audioUrl: null,
        keyHighlights: {},
        message: "Audio too small - no speech detected",
        meta: { mode, voice, language }
      });
    }

    let transcript = "";
    let responseText = "";
    let audioUrl = null;

    // ==========================================================
    // === STT SECTION (Non-streaming fallback for reliability) ===
    try {
      console.log("🎯 SERVER: Starting STT (non-streaming recognize)...");

      const audioBytes = req.file.buffer.toString("base64");

      // Detect encoding based on mimetype
      let encoding = (req.body?.encoding || "").toUpperCase();
      const mime = req.file?.mimetype || "";
      if (!encoding) {
        if (mime.includes("ogg")) encoding = "OGG_OPUS";
        else if (mime.includes("webm")) encoding = "WEBM_OPUS";
        else if (mime.includes("wav")) encoding = "LINEAR16";
        else encoding = "WEBM_OPUS";
      }

      // Build speech context with hints if provided
      const speechContexts = hints.length > 0 ? [{
        phrases: hints,
        boost: parseFloat(boost) || 16.0
      }] : [];
      
      const request = {
        audio: { content: audioBytes },
        config: {
          encoding,
          sampleRateHertz: 48000,
          languageCode: language,
          enableAutomaticPunctuation: true,
          model: "latest_long",
          useEnhanced: true, // Use enhanced model for better accuracy
          enableWordConfidence: true, // Get confidence scores for words
          enableWordTimeOffsets: true, // Get word timing information
          // Add hints for common phrases if provided
          ...(speechContexts.length > 0 ? { speechContexts } : {}),
        },
      };
      
      if (speechContexts.length > 0) {
        console.log("📝 SERVER: Using speech hints:", { phrasesCount: hints.length, boost });
      }

      console.log("🎯 SERVER: STT request config:", request.config);

      const [response] = await speechClient.recognize(request);
      const results = response.results || [];
      transcript = results.map(r => r.alternatives?.[0]?.transcript || "").join(" ").trim();
      
      // If no transcript, return early without processing further
      if (!transcript || transcript.trim() === "") {
        console.log("⚠️ SERVER: No speech detected in audio, skipping downstream processing");
        return res.status(200).json({
          transcript: "",
          responseText: "",
          audioUrl: null,
          keyHighlights: {},
          message: "No speech detected",
          meta: { mode, voice, language }
        });
      }
      
      console.log("✅ SERVER: STT completed, transcript:", transcript);
    } catch (sttError) {
      console.error("❌ SERVER: STT Error in pipeline:", sttError);
      return res.status(500).json({
        error: "STT recognition error",
        transcript: "",
        responseText: "AI response generation failed",
        message: "Speech recognition failed. Verify Google Cloud credentials and STT settings.",
        audioUrl: null,
        keyHighlights: {},
        meta: {}
      });
    }

    // ==========================================================

    // --- Sentiment Analysis ---
    let sentimentData = null;
    try {
      console.log("🔍 SERVER: Starting sentiment analysis...");
      sentimentData = await analyzeSentiment(transcript);
      console.log("✅ SERVER: Sentiment analysis complete:", sentimentData);
    } catch (sentimentError) {
      console.error('❌ SERVER: Sentiment analysis error:', sentimentError);
      sentimentData = null;
    }

    // --- Key Highlights Detection ---
    let keyHighlights = {};
    try {
      console.log("🔍 SERVER: Starting key highlights detection...");
      const userQuestion = extractUserQuestion(transcript);
      keyHighlights = await detectKeyHighlights(userQuestion, conversationHistory);
      console.log("✅ SERVER: Key highlights detected:", keyHighlights);
    } catch (highlightsError) {
      console.error('❌ SERVER: Key highlights detection error:', highlightsError);
      keyHighlights = {};
    }

    // --- GPT ---
    try {
      console.log("🤖 SERVER: Starting GPT response generation...");
      let matchedQuestion = null;

      // For sales mode, first search MongoDB for matching questions
      if (mode === "sales") {
        console.log("🔍 SERVER: Searching for matching questions in sales database...");

        // Extract just the user's question from the frontend's prompt
        const userQuestion = extractUserQuestion(transcript);
        console.log("🎯 SERVER: Extracted user question:", userQuestion);

        // Parse multiple questions from user input
        const questions = parseMultipleQuestions(userQuestion);
        console.log("🔍 SERVER: Parsed questions:", questions);

        // Search for matches for all questions
        // First try normal search, if no good matches, try force search
        let matchedQuestions = await salesQAService.findMultipleMatchingQuestions(questions);

        // If no matches or low quality matches, try force search
        if (matchedQuestions.length === 0 || (matchedQuestions[0] && matchedQuestions[0].similarity < 0.6)) {
          console.log('🔄 No good matches found, trying force search...');
          const forceMatches = [];
          for (const query of questions) {
            const forceMatch = await salesQAService.findMatchingQuestionForce(query.trim());
            if (forceMatch) {
              forceMatches.push({
                originalQuery: query.trim(),
                matchedQuestion: forceMatch.question,
                answers: forceMatch.answers,
                category: forceMatch.category,
                description: forceMatch.description,
                similarity: forceMatch.similarity || 0
              });
            }
          }
          if (forceMatches.length > 0) {
            matchedQuestions = forceMatches;
            console.log(`🎯 Force search found ${forceMatches.length} better matches`);
          }
        }

        if (matchedQuestions.length > 0) {
          console.log(`✅ SERVER: Found ${matchedQuestions.length} matching question(s):`, matchedQuestions.map(m => m.matchedQuestion));

          // Skip GPT call and use database responses directly for faster response
          console.log("⚡ SERVER: Using direct database responses for faster processing");
          responseText = matchedQuestions.map((match, index) => {
            return `Response A: ${match.answers[0].text}\nResponse B: ${match.answers[1].text}\nResponse C: ${match.answers[2].text}`;
          }).join('\n\n');
          console.log("🎯 SERVER: Direct database response generated:", responseText);
        } else {
          // No matching question found, find related questions for GPT context
          console.log("❌ SERVER: No matching question found, finding related questions for GPT analysis");

          // Extract user question for related search
          const userQuestion = extractUserQuestion(transcript);
          const relatedQuestions = await salesQAService.findRelatedQuestionsForGPT(userQuestion);

          if (relatedQuestions.length > 0) {
            console.log(`🎯 SERVER: Found ${relatedQuestions.length} related questions for GPT context`);

            // Create enhanced context from related questions
            const contextQuestions = relatedQuestions.map((q, index) =>
              `Example ${index + 1}:\nQ: ${q.question}\nA: ${q.answers[0].text}\nB: ${q.answers[1].text}\nC: ${q.answers[2].text}\nCategory: ${q.category}`
            ).join('\n\n');

            // Build conversation context for GPT
            let conversationContext = "";
            if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
              conversationContext = "\n\nCONVERSATION HISTORY:\n";
              conversationHistory.slice(-5).forEach((entry, index) => {
                conversationContext += `Previous ${index + 1}:\n`;
                conversationContext += `Customer: ${entry.userInput}\n`;
                conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
              });
              conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
            }

            let systemPrompt = `You are an expert sales assistant. You have access to a database of proven sales responses. 
            Here are some related sales scenarios and their successful responses:
            ${contextQuestions}
            ${conversationContext}
            
            Your task: Analyze the customer's question and provide 3 persuasive sales responses (A, B, C format) that are relevant to their specific concern. Use the context above to understand the sales approach and tone. Consider the conversation history to provide contextually relevant responses.`;

            systemPrompt = addLanguageInstruction(systemPrompt, language);

            let userPrompt = `Customer asked: "${userQuestion}". 
            Based on the sales context above and conversation history, provide 3 short, persuasive sales responses (A, B, C format) that directly address their question. Make sure each response is different and covers different angles of persuasion.`;
            
            userPrompt = addLanguageInstruction(userPrompt, language);

            const completion = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              max_tokens: 250,
              temperature: 0.8,
            });

            responseText = completion.choices[0].message.content;
          } else {
            // No related questions found, use general sales response
            console.log("❌ SERVER: No related questions found, using general sales response");

            // Build conversation context for general sales response
            let conversationContext = "";
            if (conversationHistory && conversationHistory.length > 0) {
              conversationContext = "\n\nCONVERSATION HISTORY:\n";
              conversationHistory.slice(-5).forEach((entry, index) => {
                conversationContext += `Previous ${index + 1}:\n`;
                conversationContext += `Customer: ${entry.userInput}\n`;
                conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
              });
              conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
            }

            let systemPrompt = `You are a sales assistant. Be persuasive and helpful. Keep responses short.${conversationContext}`;
            systemPrompt = addLanguageInstruction(systemPrompt, language);
            
            let userPrompt = `Customer: "${transcript}". Give 3 short sales responses (A, B, C format). Consider the conversation history to provide contextually relevant responses.`;
            userPrompt = addLanguageInstruction(userPrompt, language);

            const completion = await openai.chat.completions.create({
              model: "gpt-4",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
              ],
              max_tokens: 200,
              temperature: 0.7,
            });

            responseText = completion.choices[0].message.content;
          }
        }
      } else {
        // For support mode, use original logic

        // Build conversation context for support mode
        let conversationContext = "";
        if (conversationHistory && conversationHistory.length > 0) {
          conversationContext = "\n\nCONVERSATION HISTORY:\n";
          conversationHistory.slice(-5).forEach((entry, index) => {
            conversationContext += `Previous ${index + 1}:\n`;
            conversationContext += `Customer: ${entry.userInput}\n`;
            conversationContext += `Your Response: ${entry.predatorResponse}\n\n`;
          });
          conversationContext += "Use this conversation history to provide contextually relevant responses that build on previous interactions.\n";
        }

        let systemPrompt = `You are a helpful customer support assistant. Be empathetic and provide clear solutions.${conversationContext}`;
        systemPrompt = addLanguageInstruction(systemPrompt, language);
        
        let userPrompt = `Customer said: "${transcript}". Please provide a helpful response. Keep it concise and professional. Consider the conversation history to provide contextually relevant responses.`;
        userPrompt = addLanguageInstruction(userPrompt, language);

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
      
      // Check for quota exceeded error
      if (gptError.status === 429 || gptError.code === 'insufficient_quota') {
        console.log('⚠️ OpenAI quota exceeded - using fallback response');
        responseText = `Response A: I'd be happy to help you with that. Let me provide you with more information.

Response B: That's a great question. Based on your needs, here's what I recommend.

Response C: I understand your concern. Let's explore the best solution for you.`;
      } else {
        responseText = "AI response generation failed. Please try again.";
      }
    }

    // ==========================================================
    // === TTS SECTION ===
    try {
      if (responseText) {
        console.log("🔊 SERVER: Starting TTS (Text-to-Speech)...");

        // Extract ONLY Response A text for TTS - SIMPLE & DIRECT METHOD
        let ttsText = "";
        console.log("🔍 SERVER: Full responseText length:", responseText.length);
        console.log("🔍 SERVER: Full responseText (first 400 chars):", responseText.substring(0, 400));
        
        // Find position of "Response A:" (case insensitive)
        const responseAIndex = responseText.toLowerCase().indexOf("response a:");
        
        if (responseAIndex !== -1) {
          // Find where Response A text ends (before Response B: or Response C:)
          const afterResponseA = responseText.substring(responseAIndex + "Response A:".length);
          
          // Find positions of Response B: and Response C:
          const responseBIndex = afterResponseA.toLowerCase().indexOf("response b:");
          const responseCIndex = afterResponseA.toLowerCase().indexOf("response c:");
          
          // Take text until the first of Response B: or Response C: appears
          let endIndex = afterResponseA.length;
          if (responseBIndex !== -1) endIndex = Math.min(endIndex, responseBIndex);
          if (responseCIndex !== -1) endIndex = Math.min(endIndex, responseCIndex);
          
          // Extract only Response A text
          ttsText = afterResponseA.substring(0, endIndex).trim();
          
          // Clean up: remove newlines and extra spaces
          ttsText = ttsText.replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
          
          console.log("✅ SERVER: Extracted Response A (direct method):", ttsText.substring(0, 200));
        } else {
          // If no "Response A:" found, use first line only
          const firstLine = responseText.split('\n')[0];
          ttsText = firstLine.replace(/^Response [ABC]:\s*/i, "").trim();
          console.log("⚠️ SERVER: No 'Response A:' found, using first line:", ttsText.substring(0, 100));
        }

        // STRICT FINAL CHECK - Remove any remaining Response B or C references
        const lowerText = ttsText.toLowerCase();
        if (lowerText.includes("response b") || lowerText.includes("response c")) {
          // Find the position where B or C starts and cut there
          const bPos = lowerText.indexOf("response b");
          const cPos = lowerText.indexOf("response c");
          const cutPos = Math.min(
            bPos !== -1 ? bPos : ttsText.length,
            cPos !== -1 ? cPos : ttsText.length
          );
          ttsText = ttsText.substring(0, cutPos).trim();
          console.log("⚠️ SERVER: Removed Response B/C from text");
        }
        
        // Final validation: if still contains Response B or C, SKIP TTS entirely
        if (ttsText.toLowerCase().includes("response b") || ttsText.toLowerCase().includes("response c")) {
          console.error("❌ SERVER: CRITICAL ERROR - Response B or C still in text! Skipping TTS.");
          ttsText = "";
        }

        // If no valid text found, skip TTS
        if (!ttsText || ttsText.length === 0) {
          console.log("⚠️ SERVER: No valid Response A text found for TTS, skipping");
          audioUrl = null; // Ensure audioUrl is null if no valid text
        } else {
          // FINAL VERIFICATION: Log exact text being sent to TTS
          console.log("🔊 SERVER: ========== FINAL TTS TEXT (Response A ONLY) ==========");
          console.log("🔊 SERVER: Text:", ttsText);
          console.log("🔊 SERVER: Length:", ttsText.length, "characters");
          console.log("🔊 SERVER: Contains 'Response B':", ttsText.toLowerCase().includes("response b"));
          console.log("🔊 SERVER: Contains 'Response C':", ttsText.toLowerCase().includes("response c"));
          console.log("🔊 SERVER: ======================================================");
          
          const ttsVoice = getVoiceForLanguage(voice, language);
          const ttsRequest = {
            input: { text: ttsText },
            voice: {
              languageCode: language,
              name: ttsVoice,
              ssmlGender: "NEUTRAL",
            },
            audioConfig: { audioEncoding: "MP3" },
          };

          const ttsPromise = ttsClient.synthesizeSpeech(ttsRequest);
          const [ttsResponse] = await ttsPromise;
          const audioBase64 = ttsResponse.audioContent.toString("base64");
          audioUrl = `data:audio/mp3;base64,${audioBase64}`;
          console.log("🔊 SERVER: TTS audio generated successfully (Response A only).");
        }
      }
    } catch (ttsError) {
      console.error("❌ SERVER: TTS Error in pipeline:", ttsError);
      console.log("⚠️ SERVER: Falling back to browser TTS.");
    }
     // ==========================================================
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
      keyHighlights,
      sentimentData,
      meta: { mode, voice, language },
      success: true
    });
  } catch (error) {
    console.error('❌ SERVER: Pipeline Error:', error);
    return res.status(500).json({ error: "Voice pipeline failed" });
  }
});

// --- CRM API Endpoints ---

// Get customer data by email
router.get("/crm/customer/:email", async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required" });
    }

    const contact = await getContactByEmail(email);
    if (!contact) {
      return res.json({
        success: true,
        customerData: null,
        message: "No customer found with this email"
      });
    }

    // Extract key information from HubSpot contact
    const customerData = {
      id: contact.id,
      name: contact.properties.firstname || contact.properties.lastname
        ? `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim()
        : null,
      email: contact.properties.email,
      phone: contact.properties.phone,
      company: contact.properties.company,
      lastUpdated: contact.updatedAt || contact.createdAt,
      hubspotData: true // Flag to indicate this data comes from HubSpot
    };

    return res.json({
      success: true,
      customerData
    });
  } catch (error) {
    console.error('CRM Customer Fetch Error:', error);
    return res.status(500).json({ error: "Failed to fetch customer data" });
  }
});

// Create or update customer in HubSpot
router.post("/crm/customer", async (req, res) => {
  try {
    const { name, email, phoneNumber, companyName } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Create or update basic contact info
    const contactResponse = await upsertHubspotContact({
      name,
      email,
      phoneNumber,
      companyName
    });


    return res.json({
      success: true,
      message: "Customer data updated successfully",
      contactId: contactResponse.id
    });
  } catch (error) {
    console.error('CRM Customer Update Error:', error);
    return res.status(500).json({ error: "Failed to update customer data" });
  }
});

// Search customer by name or company
router.post("/crm/search-customer", async (req, res) => {
  try {
    const { name, company } = req.body;

    console.log("🔍 CRM: Searching customer by name/company:", { name, company });

    if (!name && !company) {
      return res.status(400).json({ error: "Name or company is required" });
    }

    const token = process.env.HUBSPOT_TOKEN || process.env.VITE_HUBSPOT_TOKEN;
    if (!token) {
      console.log("⚠️ HubSpot token not configured, returning empty result");
      return res.json({
        success: true,
        customers: [],
        message: "HubSpot not configured - please set HUBSPOT_TOKEN environment variable"
      });
    }

    const hubspotClient = new Hubspot({ accessToken: token });

    // Search by name first
    let searchResults = [];
    if (name) {
      try {
        // Split name into parts for better search
        const nameParts = name.trim().split(' ');
        const filters = [];

        // Search by firstname
        if (nameParts[0]) {
          filters.push({
            propertyName: "firstname",
            operator: "CONTAINS_TOKEN",
            value: nameParts[0]
          });
        }

        // Search by lastname if available
        if (nameParts[1]) {
          filters.push({
            propertyName: "lastname",
            operator: "CONTAINS_TOKEN",
            value: nameParts[1]
          });
        }

        const nameSearch = await hubspotClient.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: filters
          }],
          properties: ["firstname", "lastname", "email", "phone", "company"],
          limit: 10
        });

        if (nameSearch.results && nameSearch.results.length > 0) {
          searchResults = nameSearch.results.map(contact => ({
            id: contact.id,
            name: contact.properties.firstname || contact.properties.lastname
              ? `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim()
              : null,
            email: contact.properties.email,
            phone: contact.properties.phone,
            company: contact.properties.company,
            lastUpdated: contact.updatedAt || contact.createdAt
          }));
        }
      } catch (nameError) {
        console.error("Error searching by name:", nameError);
        if (nameError.code === 'ENOTFOUND' || nameError.message.includes('getaddrinfo ENOTFOUND')) {
          console.log("🌐 Network connectivity issue - HubSpot API not reachable");
          return res.json({
            success: true,
            customers: [],
            message: "Network connectivity issue - cannot reach HubSpot API"
          });
        }
      }
    }

    // If no results by name, try combined search (name + company)
    if (searchResults.length === 0 && name && company) {
      try {
        console.log("🔍 CRM: Trying combined search for name and company");
        const combinedSearch = await hubspotClient.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [
              {
                propertyName: "firstname",
                operator: "CONTAINS_TOKEN",
                value: name.split(' ')[0] || name
              },
              {
                propertyName: "company",
                operator: "CONTAINS_TOKEN",
                value: company
              }
            ]
          }],
          properties: ["firstname", "lastname", "email", "phone", "company"],
          limit: 10
        });

        if (combinedSearch.results && combinedSearch.results.length > 0) {
          searchResults = combinedSearch.results.map(contact => ({
            id: contact.id,
            name: contact.properties.firstname || contact.properties.lastname
              ? `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim()
              : null,
            email: contact.properties.email,
            phone: contact.properties.phone,
            company: contact.properties.company,
            lastUpdated: contact.updatedAt || contact.createdAt
          }));
          console.log("✅ CRM: Found customer with combined search");
        }
      } catch (combinedError) {
        console.error("Error in combined search:", combinedError);
      }
    }

    // If still no results, search by company only
    if (searchResults.length === 0 && company) {
      try {
        const companySearch = await hubspotClient.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: "company",
              operator: "CONTAINS_TOKEN",
              value: company
            }]
          }],
          properties: ["firstname", "lastname", "email", "phone", "company"],
          limit: 10
        });

        if (companySearch.results && companySearch.results.length > 0) {
          searchResults = companySearch.results.map(contact => ({
            id: contact.id,
            name: contact.properties.firstname || contact.properties.lastname
              ? `${contact.properties.firstname || ''} ${contact.properties.lastname || ''}`.trim()
              : null,
            email: contact.properties.email,
            phone: contact.properties.phone,
            company: contact.properties.company,
            lastUpdated: contact.updatedAt || contact.createdAt
          }));
        }
      } catch (companyError) {
        console.error("Error searching by company:", companyError);
        if (companyError.code === 'ENOTFOUND' || companyError.message.includes('getaddrinfo ENOTFOUND')) {
          console.log("🌐 Network connectivity issue - HubSpot API not reachable");
          return res.json({
            success: true,
            customers: [],
            message: "Network connectivity issue - cannot reach HubSpot API"
          });
        }
      }
    }

    console.log(`✅ CRM: Found ${searchResults.length} customer(s)`);
    return res.json({
      success: true,
      customers: searchResults
    });
  } catch (error) {
    console.error('CRM Search Customer Error:', error);
    return res.status(500).json({ error: "Failed to search customer" });
  }
});

// Extract customer information from conversation
router.post("/crm/extract-customer-info", async (req, res) => {
  try {
    const { transcript, conversationHistory = [] } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    // Use the CRM service to extract customer info
    const extractedData = await extractCustomerInfoFromTranscript(transcript, conversationHistory);

    return res.json({
      success: true,
      extractedData
    });
  } catch (error) {
    console.error('CRM Extract Customer Info Error:', error);
    return res.status(500).json({ error: "Failed to extract customer information" });
  }
});

// Extract key highlights from customer query
router.post("/crm/extract-key-highlights", async (req, res) => {
  try {
    const { transcript, conversationHistory = [] } = req.body;

    console.log("🔍 CRM: Extracting key highlights from transcript:", transcript);

    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const userQuestion = extractUserQuestion(transcript);
    const keyHighlights = await detectKeyHighlights(userQuestion, conversationHistory);

    console.log("✅ CRM: Returning key highlights:", keyHighlights);
    return res.json({
      success: true,
      keyHighlights
    });
  } catch (error) {
    console.error('CRM Extract Key Highlights Error:', error);
    return res.status(500).json({ error: "Failed to extract key highlights" });
  }
});



// Debug endpoint to test HubSpot search with specific email
router.post("/crm/debug-hubspot-search", async (req, res) => {
  try {
    const { email, name, company } = req.body;

    console.log("🔍 DEBUG: Testing HubSpot search with:", { email, name, company });

    let foundCustomer = null;
    let searchMethod = "";

    // Try email search first
    if (email) {
      try {
        console.log("🔍 DEBUG: Searching by email:", email);
        foundCustomer = await getContactByEmail(email);
        if (foundCustomer) {
          searchMethod = "email";
          console.log("✅ DEBUG: Customer found by email:", foundCustomer);
        }
      } catch (error) {
        console.error("DEBUG: Email search error:", error);
      }
    }

    // Try name/company search if email search failed
    if (!foundCustomer && (name || company)) {
      try {
        console.log("🔍 DEBUG: Searching by name/company:", { name, company });
        const token = process.env.HUBSPOT_TOKEN || process.env.VITE_HUBSPOT_TOKEN;
        if (token) {
          const hubspotClient = new Hubspot({ accessToken: token });

          const filters = [];
          if (name) {
            filters.push({
              propertyName: "firstname",
              operator: "CONTAINS_TOKEN",
              value: name
            });
          }
          if (company) {
            filters.push({
              propertyName: "company",
              operator: "CONTAINS_TOKEN",
              value: company
            });
          }

          if (filters.length > 0) {
            const searchResult = await hubspotClient.crm.contacts.searchApi.doSearch({
              filterGroups: [{ filters }],
              properties: ["email", "firstname", "lastname", "phone", "company"],
              limit: 5,
            });

            if (searchResult.results && searchResult.results.length > 0) {
              foundCustomer = searchResult.results[0];
              searchMethod = "name/company";
              console.log("✅ DEBUG: Customer found by name/company:", foundCustomer);
            }
          }
        }
      } catch (error) {
        console.error("DEBUG: Name/company search error:", error);
      }
    }

    // Transform data for response
    let transformedCustomer = null;
    if (foundCustomer) {
      const props = foundCustomer.properties || {};
      transformedCustomer = {
        id: foundCustomer.id,
        name: props.firstname || props.lastname ?
          `${props.firstname || ''} ${props.lastname || ''}`.trim() :
          null,
        email: props.email || null,
        phone: props.phone || null,
        company: props.company || null,
        hubspotData: foundCustomer
      };
    }

    return res.json({
      success: true,
      foundCustomer: transformedCustomer,
      searchMethod,
      rawHubspotData: foundCustomer,
      message: foundCustomer ? `Customer found via ${searchMethod}` : "No customer found in HubSpot"
    });

  } catch (error) {
    console.error('DEBUG HubSpot Search Error:', error);
    return res.status(500).json({ error: "Failed to debug HubSpot search" });
  }
});


// Create custom properties in HubSpot
router.post("/crm/create-custom-properties", async (req, res) => {
  try {
    console.log("🔧 Creating custom properties in HubSpot...");

    await createCustomProperties();

    return res.json({
      success: true,
      message: "Custom properties created successfully in HubSpot"
    });
  } catch (error) {
    console.error('Create Custom Properties Error:', error);
    return res.status(500).json({ error: "Failed to create custom properties" });
  }
});

// Save key highlights to HubSpot contact
router.post("/crm/save-key-highlights", async (req, res) => {
  try {
    const { email, keyHighlights } = req.body;

    console.log("💾 CRM: Saving key highlights to HubSpot:", { 
      email, 
      keyHighlights,
      highlightKeys: Object.keys(keyHighlights || {})
    });

    if (!email) {
      console.error("❌ CRM: Email is missing in request");
      return res.status(400).json({ error: "Email is required" });
    }

    if (!keyHighlights || Object.keys(keyHighlights).length === 0) {
      console.error("❌ CRM: Key highlights data is missing or empty");
      return res.status(400).json({ error: "Key highlights data is required" });
    }

    // Update the contact with key highlights
    console.log(`🔍 CRM: Looking up contact with email: ${email}`);
    const result = await updateContactWithKeyHighlights(email, keyHighlights);

    if (!result) {
      console.warn(`⚠️ CRM: No result returned from updateContactWithKeyHighlights for email: ${email}`);
      return res.json({
        success: false,
        message: "No contact found with this email or no highlights to save"
      });
    }

    console.log(`✅ CRM: Successfully saved key highlights to HubSpot contact ${result.id}`);
    return res.json({
      success: true,
      message: "Key highlights saved successfully to HubSpot",
      contactId: result.id,
      email: email
    });
  } catch (error) {
    console.error('❌ CRM Save Key Highlights Error:', error);
    console.error('   Error details:', {
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({ 
      error: "Failed to save key highlights to HubSpot",
      details: error.message 
    });
  }
});

// Save light sentiment to HubSpot contact
router.post("/crm/save-sentiment", async (req, res) => {
  try {
    const { email, sentimentData } = req.body;

    console.log("💾 CRM: Saving sentiment to HubSpot:", { 
      email, 
      sentimentData
    });

    if (!email) {
      console.error("❌ CRM: Email is missing in request");
      return res.status(400).json({ error: "Email is required" });
    }

    if (!sentimentData || !sentimentData.color) {
      console.error("❌ CRM: Sentiment data is missing or invalid");
      return res.status(400).json({ error: "Sentiment data with color is required" });
    }

    // Update the contact with sentiment
    console.log(`🔍 CRM: Looking up contact with email: ${email}`);
    const result = await updateContactWithSentiment(email, sentimentData);

    if (!result) {
      console.warn(`⚠️ CRM: No result returned from updateContactWithSentiment for email: ${email}`);
      return res.json({
        success: false,
        message: "No contact found with this email or no sentiment to save"
      });
    }

    console.log(`✅ CRM: Successfully saved sentiment to HubSpot contact ${result.id}`);
    return res.json({
      success: true,
      message: "Sentiment saved successfully to HubSpot",
      contactId: result.id,
      email: email
    });
  } catch (error) {
    console.error('❌ CRM Save Sentiment Error:', error);
    console.error('   Error details:', {
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      details: error.details,
      originalError: error.originalError ? {
        message: error.originalError.message,
        statusCode: error.originalError.statusCode,
        body: error.originalError.body
      } : null
    });
    
    // Provide more helpful error messages
    let errorMessage = error.message || "Failed to save sentiment to HubSpot";
    if (error.details?.statusCode === 400) {
      errorMessage += ". This may be because the custom sentiment properties (light_sentiment, sentiment_score, sentiment_label) don't exist in HubSpot. Please ensure these properties are created first.";
    }
    
    return res.status(500).json({ 
      error: errorMessage,
      details: error.message,
      statusCode: error.details?.statusCode || error.statusCode
    });
  }
});


export default router;


