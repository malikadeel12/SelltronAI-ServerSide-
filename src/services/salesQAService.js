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

          if (bestQuestion && bestScore > 0.2) { // Lower threshold for better matching
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
    const words1 = str1.toLowerCase().split(' ');
    const words2 = str2.toLowerCase().split(' ');
    
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
}

export default new SalesQAService();
