import OpenAI from "openai";
import { extractUserQuestion } from "./keyHighlightsService.js";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helper function to check if transcript might contain contact information ---
function mightContainContactInfo(transcript) {
  if (!transcript || transcript.trim().length < 10) {
    return false;
  }

  const lowerTranscript = transcript.toLowerCase();
  
  // Quick checks for common contact info patterns
  const contactIndicators = [
    // Email patterns
    /@/,
    /\b(email|e-mail|@gmail|@yahoo|@outlook|@hotmail)\b/,
    
    // Phone patterns
    /\b(phone|mobile|call|contact|number|\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/,
    /\d{10,}/, // At least 10 digits (likely phone)
    
    // Name patterns
    /\b(my name|i'm|i am|call me|name is|this is)\b/,
    
    // Company patterns
    /\b(company|firm|business|organization|org|corp|inc|llc|work at|work for)\b/,
    
    // Personal info keywords
    /\b(i work|i'm from|contact me|reach me|reach out|reachable)\b/
  ];

  // Check if any indicator is present
  const hasContactInfo = contactIndicators.some(pattern => pattern.test(lowerTranscript));
  
  // Additional check: if transcript is very short (like "Hi", "Hello"), skip
  if (transcript.trim().length < 20 && !hasContactInfo) {
    return false;
  }

  return hasContactInfo;
}

// --- Helper function to extract customer information from conversation ---
export async function extractCustomerInfoFromTranscript(transcript, conversationHistory = []) {
  try {

    if (!transcript) {
      return {
        email: null,
        name: null,
        phone: null,
        company: null
      };
    }

    // Quick check: Skip GPT call if transcript doesn't seem to contain contact info
    if (!mightContainContactInfo(transcript)) {
      return {
        email: null,
        name: null,
        phone: null,
        company: null
      };
    }

    // Use GPT to extract customer information from the CURRENT query only (no conversation history)
    const extractionPrompt = `Analyze the following customer query and extract ONLY personal contact information mentioned in this specific message. Return ONLY a JSON object with EXACTLY these 4 fields (use null for missing information):

{
  "email": "customer@example.com" or null,
  "name": "Customer Name" or null,
  "phone": "phone number" or null,
  "company": "Company Name" or null
}

IMPORTANT: 
- Do NOT include any other fields like budget, timeline, objections, or notes
- Only extract email, name, phone, and company
- Only extract information that is EXPLICITLY mentioned in this specific customer query
- Do NOT use any previous conversation context or make assumptions

Current customer query: "${transcript}"

Extract only personal contact information (email, name, phone, company) mentioned in this specific query. Do not make assumptions.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a CRM data extraction assistant. Extract only factual information from customer conversations and return valid JSON." },
        { role: "user", content: extractionPrompt }
      ],
      max_tokens: 300,
      temperature: 0.1,
    });

    let extractedData;
    try {
      const rawData = JSON.parse(completion.choices[0].message.content);

      // Helper function to normalize email (fix common STT transcription errors)
      function normalizeEmail(email) {
        if (!email || typeof email !== 'string') return null;
        
        // Convert "at" or " @ " to "@"
        let normalized = email.toLowerCase().replace(/\s+at\s+/gi, '@').replace(/\s+@\s+/g, '@');
        
        // Ensure @ is present
        if (!normalized.includes('@')) return null;
        
        // Split into username and domain parts
        const parts = normalized.split('@');
        if (parts.length !== 2) return null;
        
        let username = parts[0];
        let domain = parts[1];
        
        // Clean username: remove commas, dots, and extra spaces 
        username = username.replace(/[,\.\s]/g, '');
        
        // Clean domain: remove spaces but KEEP dots (for "gmail.com" -> "gmail.com", not "gmailcom")
        domain = domain.replace(/\s+/g, '').replace(/[^a-z0-9.-]/g, '');
        
        // Ensure domain has at least one dot (for proper domain format)
        if (!domain.includes('.')) {
          // Try to add common domains if missing
          const commonDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
          for (const commonDomain of commonDomains) {
            if (domain.includes(commonDomain.replace('.com', ''))) {
              domain = commonDomain;
              break;
            }
          }
        }
        
        // Reconstruct email
        const finalEmail = `${username}@${domain}`;
        
        // Basic email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(finalEmail)) {
          return finalEmail;
        }
        
        return null;
      }

      // Helper function to normalize phone (remove extra spaces, dashes, etc.)
      function normalizePhone(phone) {
        if (!phone || typeof phone !== 'string') return null;
        // Remove all non-digit characters except + at start
        const cleaned = phone.replace(/[^\d+]/g, '');
        return cleaned.length >= 10 ? cleaned : null;
      }

      // Clean up the data with normalization
      extractedData = {
        email: normalizeEmail(rawData.email),
        name: rawData.name?.trim() || null,
        phone: normalizePhone(rawData.phone),
        company: rawData.company?.trim() || null
      };
    } catch (parseError) {
      extractedData = {
        email: null,
        name: null,
        phone: null,
        company: null
      };
    }

    return extractedData;
  } catch (error) {
    
    // Check for quota exceeded
    if (error.status === 429 || error.code === 'insufficient_quota') {
    }
    
    return {
      email: null,
      name: null,
      phone: null,
      company: null
    };
  }
}

export default {
  extractCustomerInfoFromTranscript
};

