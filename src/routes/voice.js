﻿import { Router } from "express";
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
  try {
    let { mode = "sales", language = "en-US", conversationHistory = [] } = req.body || {};
    const voice = getVoiceForLanguage(req.body?.voice || DEFAULT_VOICE, language);
    
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

    // --- Sentiment Analysis ---
    let sentimentData = null;
    try {
      sentimentData = await analyzeSentiment(transcript);
    } catch (sentimentError) {
      sentimentData = null;
    }

    // --- GPT (with combined key highlights for sales mode) ---
    let keyHighlights = {};
    try {
      let matchedQuestion = null;

      // For sales mode, first search MongoDB for matching questions
      if (mode === "sales") {

        // Extract just the user's question from the frontend's prompt
        const userQuestion = extractUserQuestion(transcript);

        // Parse multiple questions from user input
        const questions = parseMultipleQuestions(userQuestion);

        // Search for matches for all questions
        // Only try normal search for speed (2-3 sec target)
        let matchedQuestions = await salesQAService.findMultipleMatchingQuestions(questions);

        if (matchedQuestions.length > 0) {

          // Skip GPT call and use database responses directly for faster response
          responseText = matchedQuestions.map((match, index) => {
            // Get answers in correct order (A, B, C)
            const answerA = match.answers.find(a => a.option === 'A');
            const answerB = match.answers.find(a => a.option === 'B');
            const answerC = match.answers.find(a => a.option === 'C');
            return `Response A: ${answerA?.text || ''}\nResponse B: ${answerB?.text || ''}\nResponse C: ${answerC?.text || ''}`;
          }).join('\n\n');
          
          // No key highlights extraction for matched questions (skip GPT call for faster response)
          keyHighlights = {};
        } else {
          // No matching question found, find related questions for GPT context

          // Extract user question for related search
          const userQuestion = extractUserQuestion(transcript);
          const relatedQuestions = await salesQAService.findRelatedQuestionsForGPT(userQuestion);

          if (relatedQuestions.length > 0) {

            // Create enhanced context from related questions
            const contextQuestions = relatedQuestions.map((q, index) => {
              const answerA = q.answers.find(a => a.option === 'A');
              const answerB = q.answers.find(a => a.option === 'B');
              const answerC = q.answers.find(a => a.option === 'C');
              return `Example ${index + 1}:\nQ: ${q.question}\nA: ${answerA?.text || ''}\nB: ${answerB?.text || ''}\nC: ${answerC?.text || ''}\nCategory: ${q.category}`;
            }).join('\n\n');

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

            // Combined GPT call for response + key highlights
            const result = await getGPTResponseWithKeyHighlights(
              systemPrompt,
              userPrompt,
              "gpt-4",
              250,
              0.8,
              userQuestion
            );
            responseText = result.responseText;
            keyHighlights = result.keyHighlights;
          } else {
            // No related questions found, use general sales response

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
            
            const userQuestion = extractUserQuestion(transcript);
            let userPrompt = `Customer: "${transcript}". Give 3 short sales responses (A, B, C format). Consider the conversation history to provide contextually relevant responses.`;
            userPrompt = addLanguageInstruction(userPrompt, language);

            // Combined GPT call for response + key highlights
            const result = await getGPTResponseWithKeyHighlights(
              systemPrompt,
              userPrompt,
              "gpt-4",
              200,
              0.7,
              userQuestion
            );
            responseText = result.responseText;
            keyHighlights = result.keyHighlights;
          }
        }
      } else {
        // For support mode, use original logic

        let systemPrompt = `You are a helpful customer support assistant. Be empathetic and provide clear solutions.`;
        systemPrompt = addLanguageInstruction(systemPrompt, language);
        
        let userPrompt = `Customer said: "${transcript}". Please provide a helpful response. Keep it concise and professional.`;
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

    } catch (gptError) {
      
      // Check for quota exceeded error
      if (gptError.status === 429 || gptError.code === 'insufficient_quota') {
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

        // Extract ONLY Response A text for TTS - SIMPLE & DIRECT METHOD
        let ttsText = "";
        
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
          
        } else {
          // If no "Response A:" found, use first line only
          const firstLine = responseText.split('\n')[0];
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
          ttsText = "";
        }

        // If no valid text found, skip TTS
        if (!ttsText || ttsText.length === 0) {
          audioUrl = null; // Ensure audioUrl is null if no valid text
        } else {
          // FINAL VERIFICATION: Log exact text being sent to TTS
          
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
        }
      }
    } catch (ttsError) {
    }

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