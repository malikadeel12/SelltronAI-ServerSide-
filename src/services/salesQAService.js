import SalesQA from '../models/SalesQA.js';

class SalesQAService {
  /**
   * Search for matching questions in MongoDB
   * @param {string} query - The user's spoken query
   * @returns {Object|null} - Matching question with all 3 answers or null
   */
  async findMatchingQuestion(query) {
    try {
      if (!query || typeof query !== 'string') {
        return null;
      }

      // Clean and normalize the query
      const cleanQuery = this.normalizeQuery(query);
      console.log('🔍 Searching for:', cleanQuery);
      
      // Skip matching for very short queries or casual conversation
      if (cleanQuery.length < 10 || this.isCasualConversation(cleanQuery)) {
        console.log('⏭️ Skipping match for casual conversation or short query:', cleanQuery);
        return null;
      }
      
      // First try exact match
      let match = await this.exactMatch(cleanQuery);
      if (match) {
        console.log('🎯 Exact match found:', match.question);
        return match;
      }

      // Try partial match
      match = await this.partialMatch(cleanQuery);
      if (match) {
        console.log('🔍 Partial match found:', match.question);
        return match;
      }

      // Try text search
      match = await this.textSearch(cleanQuery);
      if (match) {
        console.log('📝 Text search match found:', match.question);
        return match;
      }

      console.log('❌ No matching question found for:', query);
      return null;
    } catch (error) {
      console.error('Error in findMatchingQuestion:', error);
      return null;
    }
  }

  /**
   * Exact match search
   */
  async exactMatch(query) {
    // Try exact match with normalized query
    const normalizedQuery = this.normalizeQuery(query);
    
    const result = await SalesQA.findOne({
      $or: [
        { "questions.question": { $regex: new RegExp(`^${this.escapeRegex(query)}$`, 'i') } },
        { "questions.question": { $regex: new RegExp(`^${this.escapeRegex(normalizedQuery)}$`, 'i') } }
      ]
    }, {
      "questions.$": 1,
      category: 1,
      description: 1
    });

    if (result && result.questions && result.questions.length > 0) {
      return {
        question: result.questions[0].question,
        answers: result.questions[0].answers,
        category: result.category,
        description: result.description
      };
    }
    return null;
  }

  /**
   * Partial match search - looks for questions containing key words
   */
  async partialMatch(query) {
    const words = query.split(' ').filter(word => word.length > 2);
    if (words.length === 0) return null;

    // Create more flexible search patterns
    const searchPatterns = [
      // Original pattern
      words.map(word => this.escapeRegex(word)).join('.*'),
      // Pattern with word variations (singular/plural)
      words.map(word => {
        const base = word.replace(/s$/, '');
        return `(${this.escapeRegex(word)}|${this.escapeRegex(base)}|${this.escapeRegex(base + 's')})`;
      }).join('.*'),
      // Pattern with common synonyms
      words.map(word => {
        const synonyms = this.getSynonyms(word);
        if (synonyms.length > 0) {
          return `(${this.escapeRegex(word)}|${synonyms.map(s => this.escapeRegex(s)).join('|')})`;
        }
        return this.escapeRegex(word);
      }).join('.*')
    ];

    for (const pattern of searchPatterns) {
      const result = await SalesQA.findOne({
        "questions.question": { $regex: new RegExp(pattern, 'i') }
      }, {
        "questions.$": 1,
        category: 1,
        description: 1
      });

      if (result && result.questions && result.questions.length > 0) {
        return {
          question: result.questions[0].question,
          answers: result.questions[0].answers,
          category: result.category,
          description: result.description
        };
      }
    }
    return null;
  }

  /**
   * MongoDB text search
   */
  async textSearch(query) {
    try {
      // Try multiple search variations
      const searchVariations = [
        query,
        query.replace(/s$/, ''), // Remove 's' for singular
        query.replace(/(\w+)$/, '$1s'), // Add 's' for plural
        query.replace(/\b(make|makes)\b/gi, 'different'), // Replace make with different
        query.replace(/\b(solution|solutions)\b/gi, 'service') // Replace solution with service
      ];

      for (const searchQuery of searchVariations) {
        const result = await SalesQA.findOne({
          $text: { $search: searchQuery }
        }, {
          score: { $meta: "textScore" },
          "questions": 1,
          category: 1,
          description: 1
        }).sort({ score: { $meta: "textScore" } });

        if (result && result.questions && result.questions.length > 0) {
          // Find the best matching question based on text score
          let bestQuestion = null;
          let bestScore = 0;

          for (const question of result.questions) {
            const questionText = question.question.toLowerCase();
            const score = this.calculateSimilarity(query, questionText);
            if (score > bestScore) {
              bestScore = score;
              bestQuestion = question;
            }
          }

          if (bestQuestion && bestScore > 0.5) { // Higher threshold to prevent false positives
            return {
              question: bestQuestion.question,
              answers: bestQuestion.answers,
              category: result.category,
              description: result.description,
              similarity: bestScore
            };
          }
        }
      }
      return null;
    } catch (error) {
      console.error('Text search error:', error);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings
   */
  calculateSimilarity(str1, str2) {
    // Filter out common words that don't add semantic meaning
    const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'you', 'i', 'me', 'my', 'we', 'us', 'our', 'they', 'them', 'their', 'this', 'that', 'these', 'those', 'hello', 'hi', 'how', 'are', 'listening', 'talking'];
    
    const words1 = str1.toLowerCase().split(' ').filter(word => 
      word.length > 2 && !commonWords.includes(word)
    );
    const words2 = str2.toLowerCase().split(' ').filter(word => 
      word.length > 2 && !commonWords.includes(word)
    );
    
    // If no meaningful words left after filtering, return 0
    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }
    
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    
    return intersection.length / union.length;
  }

  /**
   * Escape special regex characters
   */
  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Check if query is casual conversation that shouldn't be matched
   */
  isCasualConversation(query) {
    const casualPatterns = [
      /^(hello|hi|hey)\s+(how\s+are\s+you|are\s+you\s+listening|are\s+you\s+talking)/i,
      /^(how\s+are\s+you|are\s+you\s+listening|are\s+you\s+talking)/i,
      /^(good\s+morning|good\s+afternoon|good\s+evening)/i,
      /^(thank\s+you|thanks|bye|goodbye)/i,
      /^(yes|no|ok|okay|sure|alright)/i
    ];
    
    return casualPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Normalize query for better matching
   */
  normalizeQuery(query) {
    return query
      .toLowerCase()
      .trim()
      .replace(/[.,!?;:]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Get synonyms for common words to improve matching
   */
  getSynonyms(word) {
    const synonyms = {
      'different': ['unique', 'distinct', 'special', 'unlike'],
      'free': ['complimentary', 'no-cost', 'gratis', 'zero-cost'],
      'solution': ['solutions', 'service', 'services', 'product', 'products'],
      'make': ['makes', 'makes', 'create', 'creates'],
      'you': ['your', 'yours'],
      'what': ['how', 'why'],
      'from': ['than', 'compared to', 'versus'],
      'risk': ['risks', 'endanger', 'jeopardize'],
      'career': ['careers', 'job', 'jobs', 'profession'],
      'choosing': ['choose', 'chose', 'select', 'selecting'],
      'should': ['shall', 'would', 'could']
    };
    
    return synonyms[word.toLowerCase()] || [];
  }

  /**
   * Get all categories for debugging
   */
  async getAllCategories() {
    try {
      return await SalesQA.find({}, { category: 1, description: 1, "questions.question": 1 });
    } catch (error) {
      console.error('Error getting categories:', error);
      return [];
    }
  }

  /**
   * Get question count for statistics
   */
  async getQuestionCount() {
    try {
      const result = await SalesQA.aggregate([
        { $unwind: "$questions" },
        { $count: "totalQuestions" }
      ]);
      return result[0]?.totalQuestions || 0;
    } catch (error) {
      console.error('Error getting question count:', error);
      return 0;
    }
  }

  /**
   * Find matching questions for multiple queries
   * @param {Array<string>} queries - Array of user questions
   * @returns {Array<Object>} - Array of matching questions with answers
   */
  async findMultipleMatchingQuestions(queries) {
    try {
      if (!Array.isArray(queries) || queries.length === 0) {
        return [];
      }

      console.log('🔍 Searching for multiple questions:', queries);
      const matches = [];

      for (const query of queries) {
        if (query && typeof query === 'string' && query.trim().length > 0) {
          const match = await this.findMatchingQuestion(query.trim());
          if (match) {
            matches.push({
              originalQuery: query.trim(),
              matchedQuestion: match.question,
              answers: match.answers,
              category: match.category,
              description: match.description
            });
            console.log(`✅ Found match for: "${query.trim()}" -> "${match.question}"`);
          } else {
            console.log(`❌ No match found for: "${query.trim()}"`);
          }
        }
      }

      console.log(`🎯 Total matches found: ${matches.length}/${queries.length}`);
      return matches;
    } catch (error) {
      console.error('Error in findMultipleMatchingQuestions:', error);
      return [];
    }
  }
}

export default new SalesQAService();
