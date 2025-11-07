import { Router } from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { SpeechClient } from "@google-cloud/speech";
import textToSpeech from "@google-cloud/text-to-speech";
import { TranslationServiceClient } from "@google-cloud/translate";
import OpenAI from "openai";
import fs from "fs";
import salesQAService from "../services/salesQAService.js";
import { extractUserQuestion, detectKeyHighlights } from "../services/keyHighlightsService.js";
import { extractCustomerInfoFromTranscript } from "../services/crmService.js";
import { getContactByEmail, upsertHubspotContact, createCustomProperties, updateContactWithKeyHighlights, updateContactWithSentiment, getKeyHighlightsByEmail } from "../services/hubspotService.js";
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

  return questions;
}

// --- Helper function to extract JSON from response text (handles markdown code blocks) ---
function extractJSONFromResponse(text) {
  if (!text) return null;
  
  // Try to find JSON in markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch (e) {
      // Continue to try other methods
    }
  }
  
  // Try to find JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch && jsonMatch[0]) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      // Continue to try other methods
    }
  }
  
  // Try parsing the entire text as JSON
  try {
    return JSON.parse(text.trim());
  } catch (e) {
    return null;
  }
}

// --- Helper function for combined GPT call (response + key highlights) ---
// Streaming GPT function that triggers TTS early when Response A is detected
async function getGPTResponseWithKeyHighlightsStreaming(systemPrompt, userPrompt, model, maxTokens, temperature, customerQuery, onEarlyResponse, ttsClient, voice, language) {
  return new Promise(async (resolve, reject) => {
    try {
      // Add key highlights extraction instruction to system prompt
      const enhancedSystemPrompt = `${systemPrompt}

CRITICAL: You must return your response as a valid JSON object with the following EXACT structure (no additional text, only valid JSON):
{
  "response": "Your sales responses in A, B, C format (e.g., 'Response A: ...\\nResponse B: ...\\nResponse C: ...')",
  "keyHighlights": {
    "budget": "budget information explicitly mentioned by customer" or null,
    "timeline": "timeline information explicitly mentioned by customer" or null,
    "objections": "customer objections or concerns explicitly mentioned" or null,
    "importantInfo": "other important information explicitly mentioned" or null
  }
}

IMPORTANT for key highlights: 
- Only extract information that is EXPLICITLY mentioned by the customer in their query
- Return null for fields where no relevant information is found
- Keep extracted text concise but meaningful
- Do NOT make assumptions or add information not mentioned
- The "response" field must contain your sales responses in the exact format: "Response A: ...\\nResponse B: ...\\nResponse C: ..."
- Return ONLY the JSON object, no additional text or markdown formatting`;

      let streamedText = "";
      let earlyTtsTriggered = false;
      let responseAStartIndex = -1;
      let responseAText = "";
      const MIN_WORDS_FOR_EARLY_TTS = 25; // Minimum words to trigger early TTS

      const stream = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: "system", content: enhancedSystemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: maxTokens + 150,
        temperature: temperature,
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          streamedText += content;

          // Check if we've found "Response A:" and haven't triggered early TTS yet
          if (!earlyTtsTriggered) {
            const lowerText = streamedText.toLowerCase();
            const responseAIndex = lowerText.indexOf("response a:");
            
            if (responseAIndex !== -1 && responseAStartIndex === -1) {
              responseAStartIndex = responseAIndex;
            }

            // If we found Response A and have collected enough text
            if (responseAStartIndex !== -1) {
              // Extract text after "Response A:"
              const afterResponseA = streamedText.substring(responseAStartIndex + "Response A:".length);
              
              // Check if we have enough words (rough estimate: 5 chars per word)
              const wordCount = afterResponseA.trim().split(/\s+/).length;
              
              if (wordCount >= MIN_WORDS_FOR_EARLY_TTS) {
                // Extract Response A text (stop before Response B or C)
                let ttsText = afterResponseA;
                const responseBIndex = ttsText.toLowerCase().indexOf("response b:");
                const responseCIndex = ttsText.toLowerCase().indexOf("response c:");
                
                if (responseBIndex !== -1) {
                  ttsText = ttsText.substring(0, responseBIndex);
                } else if (responseCIndex !== -1) {
                  ttsText = ttsText.substring(0, responseCIndex);
                }
                
                // Clean up the text
                ttsText = ttsText.trim().replace(/\r\n/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
                
                // Make sure we have valid text without Response B/C references
                if (ttsText && 
                    ttsText.length > 10 && 
                    !ttsText.toLowerCase().includes("response b") && 
                    !ttsText.toLowerCase().includes("response c")) {
                  
                  earlyTtsTriggered = true;
                  responseAText = ttsText;
                  
                  // Generate TTS early in background (don't wait)
                  const earlyTtsStartTime = Date.now();
                  (async () => {
                    try {
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

                      const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
                      const audioBase64 = ttsResponse.audioContent.toString("base64");
                      const audioUrl = `data:audio/mp3;base64,${audioBase64}`;
                      
                      const earlyTtsTime = Date.now() - earlyTtsStartTime;
                      console.log(`⚡ BACKEND: Early TTS generated in ${earlyTtsTime}ms (triggered at ${wordCount} words)`);
                      
                      // Call the callback with early audio
                      if (onEarlyResponse) {
                        onEarlyResponse(audioUrl);
                      }
                    } catch (ttsError) {
                      console.error('🔄 BACKEND: Early TTS error:', ttsError.message);
                    }
                  })();
                }
              }
            }
          }
        }
      }

      // Parse the complete response
      const rawResponse = streamedText.trim();
      const result = extractJSONFromResponse(rawResponse);
      
      if (result && result.response) {
        const responseText = result.response;
        const keyHighlights = result.keyHighlights || {};
        
        const filteredHighlights = Object.fromEntries(
          Object.entries(keyHighlights).filter(([key, value]) => 
            value !== null && value !== undefined && String(value).trim() !== ''
          )
        );

        resolve({
          responseText,
          keyHighlights: filteredHighlights,
          earlyTtsTriggered
        });
      } else {
        console.error('🔄 BACKEND: Failed to parse JSON from GPT response. Result:', result);
        reject(new Error("Response not in expected JSON format"));
      }
    } catch (error) {
      reject(error);
    }
  });
}

async function getGPTResponseWithKeyHighlights(systemPrompt, userPrompt, model, maxTokens, temperature, customerQuery) {
  try {
    // Add key highlights extraction instruction to system prompt
    const enhancedSystemPrompt = `${systemPrompt}

CRITICAL: You must return your response as a valid JSON object with the following EXACT structure (no additional text, only valid JSON):
{
  "response": "Your sales responses in A, B, C format (e.g., 'Response A: ...\\nResponse B: ...\\nResponse C: ...')",
  "keyHighlights": {
    "budget": "budget information explicitly mentioned by customer" or null,
    "timeline": "timeline information explicitly mentioned by customer" or null,
    "objections": "customer objections or concerns explicitly mentioned" or null,
    "importantInfo": "other important information explicitly mentioned" or null
  }
}

IMPORTANT for key highlights: 
- Only extract information that is EXPLICITLY mentioned by the customer in their query
- Return null for fields where no relevant information is found
- Keep extracted text concise but meaningful
- Do NOT make assumptions or add information not mentioned
- The "response" field must contain your sales responses in the exact format: "Response A: ...\\nResponse B: ...\\nResponse C: ..."
- Return ONLY the JSON object, no additional text or markdown formatting`;

    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: enhancedSystemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokens + 150, // Extra tokens for JSON structure and key highlights
      temperature: temperature,
    });

    const rawResponse = completion.choices[0].message.content.trim();
    const result = extractJSONFromResponse(rawResponse);
    
    if (result && result.response) {
      // Successfully parsed JSON with response field
      const responseText = result.response;
      const keyHighlights = result.keyHighlights || {};
      
      // Filter out null/empty values from key highlights
      const filteredHighlights = Object.fromEntries(
        Object.entries(keyHighlights).filter(([key, value]) => 
          value !== null && value !== undefined && String(value).trim() !== ''
        )
      );

      return {
        responseText,
        keyHighlights: filteredHighlights
      };
    } else {
      // Failed to parse JSON - return empty response
      console.error('🔄 BACKEND: Failed to parse JSON from GPT response. Result:', result);
      throw new Error("Response not in expected JSON format");
    }
  } catch (error) {
    // No fallback - throw error to let caller handle it
    throw error;
  }
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
}

if (!serviceAccount || !credentialsFile) {
  throw new Error("Google Cloud credentials not found! Please set up service account key.");
}

// Set the credentials file path for Google Cloud SDK
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsFile;

console.log("🔑 Google Cloud Service Account Configuration:");

// Let Google Cloud SDK automatically use GOOGLE_APPLICATION_CREDENTIALS
export const speechClient = new SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();
const translateClient = new TranslationServiceClient();

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

const DEFAULT_VOICE = "en-US-Wavenet-F"; // Soft female voice
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

// --- Translation Helper Functions ---
/**
 * Translate text from one language to another using Google Cloud Translation API
 * @param {string} text - Text to translate
 * @param {string} targetLanguage - Target language code (e.g., 'en', 'de')
 * @param {string} sourceLanguage - Source language code (e.g., 'en', 'de'). If not provided, will auto-detect
 * @returns {Promise<string>} - Translated text
 */
async function translateText(text, targetLanguage, sourceLanguage = null) {
  try {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return text;
    }

    // If source and target are the same, return original text
    if (sourceLanguage && sourceLanguage === targetLanguage) {
      return text;
    }

    const projectId = serviceAccount?.project_id || process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) {
      console.error('🔄 BACKEND: Translation failed - No project ID found');
      return text; // Return original text if translation fails
    }

    const request = {
      parent: `projects/${projectId}/locations/global`,
      contents: [text],
      mimeType: 'text/plain',
      targetLanguageCode: targetLanguage,
    };

    // Add source language if provided
    if (sourceLanguage) {
      request.sourceLanguageCode = sourceLanguage;
    }

    const [response] = await translateClient.translateText(request);
    
    if (response.translations && response.translations.length > 0) {
      return response.translations[0].translatedText;
    }

    return text; // Return original if translation fails
  } catch (error) {
    console.error('🔄 BACKEND: Translation error:', error.message);
    return text; // Return original text on error
  }
}

/**
 * Translate text from German to English
 * @param {string} text - German text to translate
 * @returns {Promise<string>} - English translated text
 */
async function translateGermanToEnglish(text) {
  return translateText(text, 'en', 'de');
}

/**
 * Translate text from English to German
 * @param {string} text - English text to translate
 * @returns {Promise<string>} - German translated text
 */
async function translateEnglishToGerman(text) {
  return translateText(text, 'de', 'en');
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
    return res.status(500).json({ error: "Failed to clear cache" });
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

    // Check for specific authentication errors
    if (error.code === 16 || error.message.includes('UNAUTHENTICATED') || error.message.includes('ACCESS_TOKEN_EXPIRED')) {
    }

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

// --- Combined Pipeline (Real APIs) ---
router.post("/pipeline", upload.none(), async (req, res) => {
  const pipelineStartTime = Date.now();
  try {
    let { mode = "sales", language = "en-US", conversationHistory = [] } = req.body || {};
    const voice = getVoiceForLanguage(req.body?.voice || DEFAULT_VOICE, language);
    console.log(`🔄 BACKEND: Pipeline started at ${new Date().toISOString()}`);
    
    
    // Ensure conversationHistory is an array
    if (!Array.isArray(conversationHistory)) {
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
        conversationHistory = [];
      }
    }

    let transcript = "";
    let responseText = "";
    let audioUrl = null;
    
    // ==========================================================
    // === EARLY TTS TRACKING (for streaming GPT) ===
    // Shared variable to track early TTS audio from streaming
    let earlyTtsAudioUrl = null;
    
    // ==========================================================
    // === TTS HELPER FUNCTION (defined early for use in DB responses) ===
    // Helper function to generate TTS
    const generateTTS = async (text, voiceParam, lang) => {
      try {
        if (!text) return null;
        
        // Extract ONLY Response A text for TTS - SIMPLE & DIRECT METHOD
        let ttsText = "";
        
        // Find position of "Response A:" (case insensitive)
        const responseAIndex = text.toLowerCase().indexOf("response a:");
        
        if (responseAIndex !== -1) {
          // Find where Response A text ends (before Response B: or Response C:)
          const afterResponseA = text.substring(responseAIndex + "Response A:".length);
          
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
          
        } else {
          // If no "Response A:" found, use first line only
          const firstLine = text.split('\n')[0];
          ttsText = firstLine.replace(/^Response [ABC]:\s*/i, "").trim();
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
        }
        
        // Final validation: if still contains Response B or C, SKIP TTS entirely
        if (ttsText.toLowerCase().includes("response b") || ttsText.toLowerCase().includes("response c")) {
          return null;
        }

        // If no valid text found, skip TTS
        if (!ttsText || ttsText.length === 0) {
          return null;
        }
        
        const ttsVoice = getVoiceForLanguage(voiceParam, lang);
        const ttsRequest = {
          input: { text: ttsText },
          voice: {
            languageCode: lang,
            name: ttsVoice,
            ssmlGender: "NEUTRAL",
          },
          audioConfig: { audioEncoding: "MP3" },
        };

        const [ttsResponse] = await ttsClient.synthesizeSpeech(ttsRequest);
        const audioBase64 = ttsResponse.audioContent.toString("base64");
        return `data:audio/mp3;base64,${audioBase64}`;
      } catch (ttsError) {
        console.error('🔄 BACKEND: TTS error:', ttsError.message);
        return null;
      }
    };

    // ==========================================================
    // === TRANSCRIPT SECTION (Use provided live transcript from WebSocket STT) ===
    transcript = req.body?.transcript || "";
    
    if (transcript && transcript.trim()) {
    } else {
        return res.status(200).json({
          transcript: "",
          responseText: "",
          audioUrl: null,
          keyHighlights: {},
        message: "No transcript provided",
          meta: { mode, voice, language }
      });
    }

    // ==========================================================

    // --- TRANSLATION: If German, translate query to English for database search ---
    const isGerman = language === "de-DE";
    let originalTranscript = transcript;
    let englishTranscript = transcript;
    let englishUserQuestion = "";
    
    if (isGerman) {
      try {
        console.log('🔄 BACKEND: Translating German query to English for database search...');
        const translationStartTime = Date.now();
        englishTranscript = await translateGermanToEnglish(transcript);
        console.log(`⏱️ BACKEND: German to English translation time: ${Date.now() - translationStartTime}ms`);
        console.log(`🔄 BACKEND: Original (German): "${transcript.substring(0, 100)}..."`);
        console.log(`🔄 BACKEND: Translated (English): "${englishTranscript.substring(0, 100)}..."`);
      } catch (translationError) {
        console.error('🔄 BACKEND: Translation error, using original transcript:', translationError.message);
        englishTranscript = transcript; // Fallback to original if translation fails
      }
    }

    // Extract user question once for reuse (optimization)
    // Use English transcript for extraction if German
    const extractStartTime = Date.now();
    englishUserQuestion = extractUserQuestion(isGerman ? englishTranscript : transcript);
    const questions = mode === "sales" ? parseMultipleQuestions(englishUserQuestion) : [];
    const extractTime = Date.now() - extractStartTime;
    console.log(`⏱️ BACKEND: Extract question time: ${extractTime}ms`);

    // --- PARALLEL OPERATIONS: Sentiment Analysis + Database Search (COMPLETELY NON-BLOCKING) ---
    // OPTIMIZATION: NO TIMEOUT - Start GPT immediately, DB search runs in background
    // If DB finds match, use it; otherwise use GPT response
    const parallelStartTime = Date.now();
    const sentimentPromise = analyzeSentiment(isGerman ? englishTranscript : transcript).catch(err => {
      console.error('🔄 BACKEND: Sentiment analysis error:', err.message);
      return null;
    });
    const dbSearchPromise = mode === "sales" ? salesQAService.findMultipleMatchingQuestions(questions) : Promise.resolve([]);
    
    // Start both promises but DON'T WAIT - GPT starts immediately
    // DB search will complete in background and we'll check it later if needed
    let sentimentData = null;
    let matchedQuestions = [];
    let dbSearchCompleted = false;
    
    // Start DB search in background (no timeout, no blocking)
    // But we'll check it quickly to see if we have a match before starting GPT
    let dbSearchResolved = false;
    dbSearchPromise.then(results => {
      matchedQuestions = results;
      dbSearchCompleted = true;
      dbSearchResolved = true;
      const dbCheckTime = Date.now() - parallelStartTime;
      console.log(`⏱️ BACKEND: DB search completed in background: ${dbCheckTime}ms (matched: ${matchedQuestions.length})`);
      if (mode === "sales" && matchedQuestions.length > 0) {
        console.log(`🔍 BACKEND: Found DB matches:`, matchedQuestions.map(m => ({ question: m.matchedQuestion, similarity: m.similarity })));
      }
    }).catch(err => {
      console.error('🔄 BACKEND: DB search error:', err.message);
      dbSearchCompleted = true;
      dbSearchResolved = true;
    });

    // --- GPT (with combined key highlights for sales mode) ---
    // OPTIMIZATION: Start GPT IMMEDIATELY without waiting for DB
    let keyHighlights = {};
    let useDbResponse = false;
    let dbResponseText = "";
    
    try {
      // Wait for DB search to complete (max 1 second) - prioritize database matches
      // This ensures we use database responses when available before starting GPT
      const dbWaitStart = Date.now();
      while (!dbSearchResolved && (Date.now() - dbWaitStart) < 1000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const dbWaitTime = Date.now() - dbWaitStart;
      if (dbWaitTime > 50) {
        console.log(`⏱️ BACKEND: Waited ${dbWaitTime}ms for DB search`);
      }
      
      // Start GPT if no DB match, otherwise use DB response
      if (mode === "sales") {
        // Check if DB found matches (even if search is still running, use what we have)
        if (matchedQuestions.length > 0) {
          console.log(`✅ BACKEND: Using database response (found ${matchedQuestions.length} match(es) immediately)`);
          useDbResponse = true;
          
          // Use database responses directly for faster response
          let englishResponseText = matchedQuestions.map((match, index) => {
            // Get answers in correct order (A, B, C)
            const answerA = match.answers.find(a => a.option === 'A');
            const answerB = match.answers.find(a => a.option === 'B');
            const answerC = match.answers.find(a => a.option === 'C');
            return `Response A: ${answerA?.text || ''}\nResponse B: ${answerB?.text || ''}\nResponse C: ${answerC?.text || ''}`;
          }).join('\n\n');
          
          // Translate response back to German if language is German
          if (isGerman) {
            try {
              console.log('🔄 BACKEND: Translating database response to German...');
              const translationStartTime = Date.now();
              dbResponseText = await translateEnglishToGerman(englishResponseText);
              console.log(`⏱️ BACKEND: English to German translation time: ${Date.now() - translationStartTime}ms`);
            } catch (translationError) {
              console.error('🔄 BACKEND: Response translation error, using English:', translationError.message);
              dbResponseText = englishResponseText; // Fallback to English if translation fails
            }
          } else {
            dbResponseText = englishResponseText;
          }
          
          responseText = dbResponseText;
          
          // Generate TTS immediately for database response (no 25-word check needed)
          // Database responses are short, so generate TTS right away
          try {
            const dbTtsStartTime = Date.now();
            audioUrl = await generateTTS(responseText, voice, language).catch(err => {
              console.error('🔄 BACKEND: Database response TTS error:', err.message);
              return null;
            });
            if (audioUrl) {
              console.log(`⚡ BACKEND: Database response TTS generated in ${Date.now() - dbTtsStartTime}ms`);
            }
          } catch (ttsErr) {
            console.error('🔄 BACKEND: Database response TTS generation failed:', ttsErr.message);
          }
          
          // Run key highlights extraction in parallel (non-blocking)
          const userQuestionForHighlights = isGerman ? extractUserQuestion(originalTranscript) : englishUserQuestion;
          detectKeyHighlights(userQuestionForHighlights, conversationHistory).then(h => {
            if (h && Object.keys(h).length > 0) {
              keyHighlights = h;
            }
          }).catch(err => {
            console.error('🔄 BACKEND: Key highlights extraction error:', err.message);
          });
        } else {
          // No DB match found immediately - start GPT streaming immediately
          // OPTIMIZATION: Start GPT with minimal context (conversation history only)
          // Don't wait for related questions search - it's too slow
          
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

          let systemPrompt = `You are an expert sales assistant. Be persuasive and helpful. Keep responses short and relevant.${conversationContext}`;
          systemPrompt = addLanguageInstruction(systemPrompt, language);

          // Use original user question (in German if German, English otherwise) for GPT prompt
          const userQuestionForGPT = isGerman ? extractUserQuestion(originalTranscript) : englishUserQuestion;
          let userPrompt = `Customer asked: "${userQuestionForGPT}". 
          Provide 3 short, persuasive sales responses (A, B, C format) that directly address their question. Make sure each response is different and covers different angles of persuasion.`;
          
          userPrompt = addLanguageInstruction(userPrompt, language);
          
          // Combined GPT call for response + key highlights with STREAMING for early TTS
          // OPTIMIZATION: Use streaming to trigger TTS as soon as Response A has 25 words
          try {
            const gptStartTime = Date.now();
            
            // Callback for early TTS audio - stores it in shared variable
            const onEarlyTTS = (audioUrl) => {
              earlyTtsAudioUrl = audioUrl;
              console.log(`⚡ BACKEND: Early TTS audio ready!`);
            };
            
            const result = await getGPTResponseWithKeyHighlightsStreaming(
              systemPrompt,
              userPrompt,
              "gpt-4o-mini", // Using faster model
              200, // Reduced from 250 for faster response
              0.7, // Reduced from 0.8 for faster response
              userQuestionForGPT,
              onEarlyTTS,
              ttsClient,
              voice,
              language
            );
            console.log(`⏱️ BACKEND: GPT call (minimal context, streaming) time: ${Date.now() - gptStartTime}ms`);
            responseText = result.responseText; // GPT response is already in German if language is German (handled by addLanguageInstruction)
            keyHighlights = result.keyHighlights || {};
            
            // Use early TTS audio if available
            if (earlyTtsAudioUrl) {
              audioUrl = earlyTtsAudioUrl;
              console.log(`⚡ BACKEND: Using early TTS audio (generated during GPT streaming)`);
            }
            
            // If no key highlights from GPT, try separate extraction (non-blocking)
            // Use original user question (in original language) for key highlights
            const userQuestionForHighlights = isGerman ? extractUserQuestion(originalTranscript) : englishUserQuestion;
            if (!keyHighlights || Object.keys(keyHighlights).length === 0) {
              // Run in background, don't wait
              detectKeyHighlights(userQuestionForHighlights, conversationHistory).then(h => {
                if (h && Object.keys(h).length > 0) {
                  keyHighlights = h;
                }
              }).catch(err => {
                console.error('🔄 BACKEND: Separate key highlights extraction error:', err.message);
              });
            }
          } catch (gptError) {
            console.error('🔄 BACKEND: GPT call failed, trying separate key highlights extraction:', gptError.message);
            // If GPT fails, try to extract key highlights separately
            const userQuestionForHighlights = isGerman ? extractUserQuestion(originalTranscript) : englishUserQuestion;
            try {
              keyHighlights = await detectKeyHighlights(userQuestionForHighlights, conversationHistory);
            } catch (extractError) {
              console.error('🔄 BACKEND: Separate extraction also failed:', extractError.message);
              keyHighlights = {};
            }
            throw gptError; // Re-throw to be handled by outer catch
          }
        }
      } else if (mode === "support") {
        // For support mode, use original logic
        // Use original transcript (in original language) for support mode
        const transcriptForSupport = isGerman ? originalTranscript : transcript;

        let systemPrompt = `You are a helpful customer support assistant. Be empathetic and provide clear solutions.`;
        systemPrompt = addLanguageInstruction(systemPrompt, language);
        
        let userPrompt = `Customer said: "${transcriptForSupport}". Please provide a helpful response. Keep it concise and professional.`;
        userPrompt = addLanguageInstruction(userPrompt, language);

        const gptStartTime = Date.now();
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          max_tokens: 200,
          temperature: 0.7,
        });
        console.log(`⏱️ BACKEND: GPT call (support mode) time: ${Date.now() - gptStartTime}ms`);

        responseText = completion.choices[0].message.content;
      }

    } catch (gptError) {
      console.error('🔄 BACKEND: GPT error:', gptError.message);
      
      // Check for quota exceeded error
      if (gptError.status === 429 || gptError.code === 'insufficient_quota') {
        responseText = `Response A: I'd be happy to help you with that. Let me provide you with more information.

Response B: That's a great question. Based on your needs, here's what I recommend.

Response C: I understand your concern. Let's explore the best solution for you.`;
      } else {
        responseText = "AI response generation failed. Please try again.";
      }
      
      // Final fallback: Try to extract key highlights even if GPT failed
      // Use original user question (in original language) for key highlights
      const userQuestionForHighlights = isGerman ? extractUserQuestion(originalTranscript) : englishUserQuestion;
      if (!keyHighlights || Object.keys(keyHighlights).length === 0) {
        try {
          keyHighlights = await detectKeyHighlights(userQuestionForHighlights, conversationHistory);
        } catch (extractError) {
          console.error('🔄 BACKEND: Outer catch - key highlights extraction failed:', extractError.message);
          // keyHighlights remains as {} or whatever was set before
        }
      }
    }

    // ==========================================================
    // === TTS SECTION (Generate as soon as we have responseText) ===
    // Note: generateTTS function is defined at the top of the function scope
    // Note: earlyTtsAudioUrl is declared at the top of the function scope

    // Get sentiment data (if ready)
    try {
      sentimentData = await Promise.race([
        sentimentPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 100)) // Wait max 100ms
      ]);
    } catch (e) {
      sentimentData = null;
    }
    const parallelTime = Date.now() - parallelStartTime;
    if (parallelTime > 100) {
      console.log(`⏱️ BACKEND: Background operations (sentiment + DB search) time: ${parallelTime}ms`);
    }
    
    // Calculate timing BEFORE waiting for TTS
    const gptProcessingEndTime = Date.now();
    const processingTime = gptProcessingEndTime - parallelStartTime;
    
    // OPTIMIZATION: If early TTS was triggered, wait a bit for it to complete, otherwise generate normally
    const ttsStartTime = Date.now();
    try {
      if (audioUrl) {
        // Early TTS already available - use it
        console.log(`⚡ BACKEND: Using early TTS audio (no additional generation needed)`);
      } else if (responseText) {
        // Early TTS not triggered or not ready - wait a bit if it might be generating, then generate normally
        if (mode === "sales") {
          // For sales mode, wait up to 300ms for early TTS to complete (reduced from 500ms)
          const earlyTtsWaitStart = Date.now();
          while (!earlyTtsAudioUrl && !audioUrl && (Date.now() - earlyTtsWaitStart) < 300) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (earlyTtsAudioUrl && !audioUrl) {
            audioUrl = earlyTtsAudioUrl;
            console.log(`⚡ BACKEND: Early TTS completed after ${Date.now() - earlyTtsWaitStart}ms wait`);
          }
        }
        
        // If still no audio URL, generate TTS normally
        if (!audioUrl) {
          audioUrl = await generateTTS(responseText, voice, language).catch(err => {
            console.error('🔄 BACKEND: TTS generation error:', err.message);
            return null;
          });
          if (audioUrl) {
            console.log(`⏱️ BACKEND: Normal TTS generation time: ${Date.now() - ttsStartTime}ms`);
          }
        }
      }
    } catch (ttsError) {
      console.error('🔄 BACKEND: TTS final error:', ttsError.message);
      audioUrl = null;
    }

    const totalTime = Date.now() - pipelineStartTime;
    const ttsTime = audioUrl ? (Date.now() - ttsStartTime) : 0;
    console.log(`✅ BACKEND: Total pipeline time: ${totalTime}ms`);
    console.log(`📊 BACKEND: Breakdown - Extract: ${extractTime}ms, Parallel ops: ${parallelTime}ms, GPT/Processing: ${processingTime}ms, TTS: ${ttsTime}ms`);

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
    console.error('🔄 BACKEND: Pipeline fatal error:', error.message);
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
    return res.status(500).json({ error: "Failed to update customer data" });
  }
});

// Search customer by name or company
router.post("/crm/search-customer", async (req, res) => {
  try {
    const { name, company } = req.body;

    if (!name && !company) {
      return res.status(400).json({ error: "Name or company is required" });
    }

    const token = process.env.HUBSPOT_TOKEN || process.env.VITE_HUBSPOT_TOKEN;
    if (!token) {
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
        if (nameError.code === 'ENOTFOUND' || nameError.message.includes('getaddrinfo ENOTFOUND')) {
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
        }
      } catch (combinedError) {
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
        if (companyError.code === 'ENOTFOUND' || companyError.message.includes('getaddrinfo ENOTFOUND')) {
          return res.json({
            success: true,
            customers: [],
            message: "Network connectivity issue - cannot reach HubSpot API"
          });
        }
      }
    }

    return res.json({
      success: true,
      customers: searchResults
    });
  } catch (error) {
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
    return res.status(500).json({ error: "Failed to extract customer information" });
  }
});

// Extract key highlights from customer query
router.post("/crm/extract-key-highlights", async (req, res) => {
  try {
    const { transcript, conversationHistory = [] } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const userQuestion = extractUserQuestion(transcript);
    const keyHighlights = await detectKeyHighlights(userQuestion, conversationHistory);

    return res.json({
      success: true,
      keyHighlights
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to extract key highlights" });
  }
});

// Debug endpoint to test HubSpot search with specific email
router.post("/crm/debug-hubspot-search", async (req, res) => {
  try {
    const { email, name, company } = req.body;

    let foundCustomer = null;
    let searchMethod = "";

    // Try email search first
    if (email) {
      try {
        foundCustomer = await getContactByEmail(email);
        if (foundCustomer) {
          searchMethod = "email";
        }
      } catch (error) {
      }
    }

    // Try name/company search if email search failed
    if (!foundCustomer && (name || company)) {
      try {
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
            }
          }
        }
      } catch (error) {
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
    return res.status(500).json({ error: "Failed to debug HubSpot search" });
  }
});

// Create custom properties in HubSpot
router.post("/crm/create-custom-properties", async (req, res) => {
  try {

    await createCustomProperties();

    return res.json({
      success: true,
      message: "Custom properties created successfully in HubSpot"
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to create custom properties" });
  }
});

// Get key highlights from HubSpot contact by email
router.get("/crm/key-highlights/:email", async (req, res) => {
  try {
    const { email } = req.params;
    
    if (!email) {
      return res.status(400).json({ error: "Email parameter is required" });
    }

    const keyHighlights = await getKeyHighlightsByEmail(email);

    if (!keyHighlights) {
      return res.json({
        success: true,
        keyHighlights: {},
        message: "No key highlights found for this customer"
      });
    }

    return res.json({
      success: true,
      keyHighlights
    });
  } catch (error) {
    return res.status(500).json({ 
      error: "Failed to fetch key highlights from HubSpot",
      details: error.message 
    });
  }
});

// Save key highlights to HubSpot contact
router.post("/crm/save-key-highlights", async (req, res) => {
  try {
    const { email, keyHighlights } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!keyHighlights || Object.keys(keyHighlights).length === 0) {
      return res.status(400).json({ error: "Key highlights data is required" });
    }

    // Update the contact with key highlights
    const result = await updateContactWithKeyHighlights(email, keyHighlights);

    if (!result) {
      return res.json({
        success: false,
        message: "No contact found with this email or no highlights to save"
      });
    }

    return res.json({
      success: true,
      message: "Key highlights saved successfully to HubSpot",
      contactId: result.id,
      email: email
    });
  } catch (error) {
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

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!sentimentData || !sentimentData.color) {
      return res.status(400).json({ error: "Sentiment data with color is required" });
    }

    // Update the contact with sentiment
    const result = await updateContactWithSentiment(email, sentimentData);

    if (!result) {
      return res.json({
        success: false,
        message: "No contact found with this email or no sentiment to save"
      });
    }

    return res.json({
      success: true,
      message: "Sentiment saved successfully to HubSpot",
      contactId: result.id,
      email: email
    });
  } catch (error) {
    
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