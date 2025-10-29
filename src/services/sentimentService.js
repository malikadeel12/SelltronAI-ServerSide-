import language from '@google-cloud/language';

// Initialize the Natural Language client
const languageClient = new language.LanguageServiceClient();

/**
 * Analyze sentiment of text using Google Cloud Natural Language API
 * Returns traffic light system based on sentiment:
 * - Green: positive sentiment (score > 0.1)
 * - Yellow: neutral/small talk (-0.1 <= score <= 0.1)
 * - Red: negative/objection sentiment (score < -0.1)
 * 
 * @param {string} text - The text to analyze
 * @returns {Object} Sentiment data with score, magnitude, color, and sentiment label
 */
export async function analyzeSentiment(text) {
  try {
    console.log("🔍 Sentiment Service: Analyzing text:", text.substring(0, 100) + "...");

    if (!text || text.trim().length === 0) {
      console.log("⚠️ Sentiment Service: Empty text provided");
      return {
        score: 0,
        magnitude: 0,
        color: 'yellow',
        sentiment: 'neutral',
        error: 'Empty text'
      };
    }

    // Prepare document for analysis
    const document = {
      content: text,
      type: 'PLAIN_TEXT',
    };

    // Analyze sentiment
    const [result] = await languageClient.analyzeSentiment({ document });
    const sentiment = result.documentSentiment;

    console.log("✅ Sentiment Service: Analysis complete:", {
      score: sentiment.score,
      magnitude: sentiment.magnitude
    });

    // Determine color and sentiment based on score
    let color = 'yellow'; // default
    let sentimentLabel = 'neutral';

    if (sentiment.score > 0.1) {
      color = 'green';
      sentimentLabel = 'positive';
    } else if (sentiment.score < -0.1) {
      color = 'red';
      sentimentLabel = 'negative';
    } else {
      color = 'yellow';
      sentimentLabel = 'neutral';
    }

    return {
      score: sentiment.score,
      magnitude: sentiment.magnitude,
      color,
      sentiment: sentimentLabel
    };

  } catch (error) {
    console.error('❌ Sentiment Service Error:', error);
    
    // Return neutral sentiment on error
    return {
      score: 0,
      magnitude: 0,
      color: 'yellow',
      sentiment: 'neutral',
      error: error.message || 'Sentiment analysis failed'
    };
  }
}

export default {
  analyzeSentiment
};

