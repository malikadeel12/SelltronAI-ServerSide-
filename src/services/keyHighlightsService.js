import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helper function to extract user question from frontend prompt ---
export function extractUserQuestion(transcript) {
  // The frontend sends: "Customer said: "question". SALES MODE INSTRUCTIONS: ..."
  // We need to extract just the question part

  // Look for the pattern: Customer said: "question"
  const match = transcript.match(/Customer said:\s*"([^"]+)"/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Fallback: if no match found, return the original transcript
  return transcript;
}

// --- Helper function to detect key highlights from customer query ---
export async function detectKeyHighlights(customerQuery, conversationHistory = []) {
  try {

    const highlightsPrompt = `Analyze the following customer conversation and extract key highlights. Return ONLY a JSON object with these exact fields:

{
  "budget": "budget information mentioned" or null,
  "timeline": "timeline information mentioned" or null,
  "objections": "customer objections or concerns mentioned" or null,
  "importantInfo": "other important information mentioned" or null
}

IMPORTANT: 
- Only extract information that is explicitly mentioned by the customer
- Return null for fields where no relevant information is found
- Keep extracted text concise but meaningful
- Do NOT make assumptions or add information not mentioned

Customer query: "${customerQuery}"

Extract only the key highlights mentioned by the customer in this specific query.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: "You are a key highlights extraction assistant. Extract only factual information mentioned by customers and return valid JSON." },
        { role: "user", content: highlightsPrompt }
      ],
      max_tokens: 300,
      temperature: 0.1,
    });

    let keyHighlights;
    try {
      const rawData = JSON.parse(completion.choices[0].message.content);

      // Clean up the data and filter out null values
      keyHighlights = {
        budget: rawData.budget || null,
        timeline: rawData.timeline || null,
        objections: rawData.objections || null,
        importantInfo: rawData.importantInfo || null
      };

      // Remove null values to keep only meaningful highlights
      const filteredHighlights = Object.fromEntries(
        Object.entries(keyHighlights).filter(([key, value]) => value !== null && value.trim() !== '')
      );

      return filteredHighlights;
    } catch (parseError) {
      return {};
    }
  } catch (error) {
    
    // Check for quota exceeded
    if (error.status === 429 || error.code === 'insufficient_quota') {
    }
    
    return {};
  }
}

export default {
  extractUserQuestion,
  detectKeyHighlights
};

