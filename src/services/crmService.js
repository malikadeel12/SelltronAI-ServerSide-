import OpenAI from "openai";
import { extractUserQuestion } from "./keyHighlightsService.js";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helper function to extract customer information from conversation ---
export async function extractCustomerInfoFromTranscript(transcript, conversationHistory = []) {
  try {
    console.log("🔍 CRM: Extracting customer info from transcript:", transcript);

    if (!transcript) {
      return {
        email: null,
        name: null,
        phone: null,
        company: null
      };
    }

    // Use GPT to extract customer information from the conversation
    const extractionPrompt = `Analyze the following customer conversation and extract ONLY personal contact information. Return ONLY a JSON object with EXACTLY these 4 fields (use null for missing information):

{
  "email": "customer@example.com" or null,
  "name": "Customer Name" or null,
  "phone": "phone number" or null,
  "company": "Company Name" or null
}

IMPORTANT: Do NOT include any other fields like budget, timeline, objections, or notes. Only extract email, name, phone, and company.

Customer conversation: "${transcript}"

${conversationHistory.length > 0 ? `Previous conversation context: ${JSON.stringify(conversationHistory.slice(-3))}` : ''}

Extract only personal contact information (email, name, phone, company) mentioned in the conversation. Do not make assumptions.`;

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
      console.log("🔍 CRM: GPT extracted data:", rawData);

      // Clean up the data to only include the required fields
      extractedData = {
        email: rawData.email || null,
        name: rawData.name || null,
        phone: rawData.phone || null,
        company: rawData.company || null
      };
    } catch (parseError) {
      console.error('Failed to parse extracted data:', parseError);
      extractedData = {
        email: null,
        name: null,
        phone: null,
        company: null
      };
    }

    console.log("✅ CRM: Returning extracted data:", extractedData);
    return extractedData;
  } catch (error) {
    console.error('CRM Extract Customer Info Error:', error);
    
    // Check for quota exceeded
    if (error.status === 429 || error.code === 'insufficient_quota') {
      console.log('⚠️ OpenAI quota exceeded in CRM extraction - skipping');
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

