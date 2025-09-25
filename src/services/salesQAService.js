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

      // Try fuzzy matching for incomplete or similar queries
      match = await this.fuzzyMatch(cleanQuery);
      if (match) {
        console.log('🔍 Fuzzy match found:', match.question);
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
   * Partial match search - looks for questions containing key words with fuzzy matching
   */
  async partialMatch(query) {
    const words = query.split(' ').filter(word => word.length > 2);
    if (words.length === 0) return null;

    // Create multiple flexible search patterns
    const searchPatterns = [
      // Original pattern with all words
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
      }).join('.*'),
      
      // Pattern with spelling variations (common typos)
      words.map(word => this.getSpellingVariations(word)).join('.*'),
      
      // Pattern with at least 70% of the words (more forgiving)
      words.slice(0, Math.ceil(words.length * 0.7)).map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern with key words only (remove common words)
      words.filter(word => !this.isCommonWord(word)).map(word => this.escapeRegex(word)).join('.*')
    ];

    // Try each pattern and find the best match
    let bestMatch = null;
    let bestScore = 0;

    for (const pattern of searchPatterns) {
      const results = await SalesQA.find({
        "questions.question": { $regex: new RegExp(pattern, 'i') }
      }, {
        "questions": 1,
        category: 1,
        description: 1
      });

      if (results && results.length > 0) {
        // Find the best matching question from all results
        for (const result of results) {
          for (const question of result.questions) {
            const similarity = this.calculateSimilarity(query, question.question);
            if (similarity > bestScore && similarity > 0.3) { // Lower threshold for partial matches
              bestScore = similarity;
              bestMatch = {
                question: question.question,
                answers: question.answers,
                category: result.category,
                description: result.description,
                similarity: similarity
              };
            }
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * MongoDB text search with improved flexibility
   */
  async textSearch(query) {
    try {
      // Create multiple search variations for better matching
      const searchVariations = [
        query,
        query.replace(/s$/, ''), // Remove 's' for singular
        query.replace(/(\w+)$/, '$1s'), // Add 's' for plural
        query.replace(/\b(make|makes)\b/gi, 'different'), // Replace make with different
        query.replace(/\b(solution|solutions)\b/gi, 'service'), // Replace solution with service
        query.replace(/\b(writing|written)\b/gi, 'document'), // Replace writing with document
        query.replace(/\b(send|sending)\b/gi, 'provide'), // Replace send with provide
        query.replace(/\b(everything|all)\b/gi, 'complete'), // Replace everything with complete
        // Split into key words only
        query.split(' ').filter(word => !this.isCommonWord(word) && word.length > 2).join(' '),
        // Try with synonyms
        this.replaceWithSynonyms(query)
      ];

      let bestMatch = null;
      let bestScore = 0;

      for (const searchQuery of searchVariations) {
        if (!searchQuery || searchQuery.trim().length < 3) continue;

        try {
          const results = await SalesQA.find({
            $text: { $search: searchQuery }
          }, {
            score: { $meta: "textScore" },
            "questions": 1,
            category: 1,
            description: 1
          }).sort({ score: { $meta: "textScore" } }).limit(10);

          if (results && results.length > 0) {
            // Find the best matching question from all results
            for (const result of results) {
              for (const question of result.questions) {
                const questionText = question.question.toLowerCase();
                const score = this.calculateSimilarity(query, questionText);
                if (score > bestScore && score > 0.25) { // Lower threshold for text search
                  bestScore = score;
                  bestMatch = {
                    question: question.question,
                    answers: question.answers,
                    category: result.category,
                    description: result.description,
                    similarity: score
                  };
                }
              }
            }
          }
        } catch (searchError) {
          // If text search fails, try regex search as fallback
          const regexResults = await SalesQA.find({
            "questions.question": { $regex: new RegExp(this.escapeRegex(searchQuery), 'i') }
          }, {
            "questions": 1,
            category: 1,
            description: 1
          }).limit(5);

          if (regexResults && regexResults.length > 0) {
            for (const result of regexResults) {
              for (const question of result.questions) {
                const questionText = question.question.toLowerCase();
                const score = this.calculateSimilarity(query, questionText);
                if (score > bestScore && score > 0.25) {
                  bestScore = score;
                  bestMatch = {
                    question: question.question,
                    answers: question.answers,
                    category: result.category,
                    description: result.description,
                    similarity: score
                  };
                }
              }
            }
          }
        }
      }

      return bestMatch;
    } catch (error) {
      console.error('Text search error:', error);
      return null;
    }
  }

  /**
   * Replace words with their synonyms for better matching
   */
  replaceWithSynonyms(query) {
    const words = query.split(' ');
    const replacedWords = words.map(word => {
      const synonyms = this.getSynonyms(word);
      if (synonyms.length > 0) {
        // Return the first synonym to try
        return synonyms[0];
      }
      return word;
    });
    return replacedWords.join(' ');
  }

  /**
   * Fuzzy matching for incomplete or similar queries
   */
  async fuzzyMatch(query) {
    try {
      // Get all questions from database
      const allCategories = await SalesQA.find({}, {
        "questions.question": 1,
        "questions.answers": 1,
        category: 1,
        description: 1
      });

      let bestMatch = null;
      let bestScore = 0;

      // Check each question for similarity
      for (const category of allCategories) {
        for (const question of category.questions) {
          const similarity = this.calculateSimilarity(query, question.question);
          
          // Also try with normalized versions
          const normalizedQuery = this.normalizeQuery(query);
          const normalizedQuestion = this.normalizeQuery(question.question);
          const normalizedSimilarity = this.calculateSimilarity(normalizedQuery, normalizedQuestion);
          
          const maxSimilarity = Math.max(similarity, normalizedSimilarity);
          
          if (maxSimilarity > bestScore && maxSimilarity > 0.2) { // Lower threshold for fuzzy matching
            bestScore = maxSimilarity;
            bestMatch = {
              question: question.question,
              answers: question.answers,
              category: category.category,
              description: category.description,
              similarity: maxSimilarity
            };
          }
        }
      }

      return bestMatch;
    } catch (error) {
      console.error('Fuzzy match error:', error);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings with improved algorithm
   */
  calculateSimilarity(str1, str2) {
    const words1 = str1.toLowerCase().split(' ').filter(word => 
      word.length > 2 && !this.isCommonWord(word)
    );
    const words2 = str2.toLowerCase().split(' ').filter(word => 
      word.length > 2 && !this.isCommonWord(word)
    );
    
    // If no meaningful words left after filtering, return 0
    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }
    
    // Calculate Jaccard similarity (intersection over union)
    const intersection = words1.filter(word => words2.includes(word));
    const union = [...new Set([...words1, ...words2])];
    const jaccardSimilarity = intersection.length / union.length;
    
    // Calculate word order similarity (bonus for words in similar positions)
    let orderBonus = 0;
    const minLength = Math.min(words1.length, words2.length);
    for (let i = 0; i < minLength; i++) {
      if (words1[i] === words2[i]) {
        orderBonus += 0.1; // Small bonus for words in same position
      }
    }
    
    // Calculate synonym similarity
    let synonymBonus = 0;
    for (const word1 of words1) {
      for (const word2 of words2) {
        if (word1 !== word2) {
          const synonyms1 = this.getSynonyms(word1);
          const synonyms2 = this.getSynonyms(word2);
          if (synonyms1.includes(word2) || synonyms2.includes(word1)) {
            synonymBonus += 0.05; // Small bonus for synonyms
          }
        }
      }
    }
    
    // Combine all similarity measures
    const totalSimilarity = Math.min(1, jaccardSimilarity + orderBonus + synonymBonus);
    
    return totalSimilarity;
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
      'should': ['shall', 'would', 'could'],
      'writing': ['written', 'document', 'documentation', 'email', 'text'],
      'send': ['sending', 'email', 'provide', 'give', 'share'],
      'everything': ['all', 'complete', 'full', 'entire'],
      'information': ['info', 'details', 'data', 'facts'],
      'document': ['documents', 'paper', 'papers', 'file', 'files'],
      'written': ['writing', 'text', 'documentation', 'email']
    };
    
    return synonyms[word.toLowerCase()] || [];
  }

  /**
   * Get spelling variations for common typos
   */
  getSpellingVariations(word) {
    const variations = [this.escapeRegex(word)];
    
    // Common spelling mistakes
    const commonMistakes = {
      'writing': ['writting', 'writng', 'writin'],
      'everything': ['everthing', 'everythng', 'everythin'],
      'information': ['infromation', 'informtion', 'informaton'],
      'document': ['documnt', 'documnet', 'documet'],
      'written': ['writen', 'writtn', 'writen'],
      'send': ['snd', 'sed', 'sned'],
      'you': ['yu', 'yo', 'yuo'],
      'your': ['yur', 'yor', 'youre'],
      'about': ['abut', 'abot', 'abou'],
      'because': ['becuse', 'becasue', 'becuase'],
      'business': ['bussiness', 'busines', 'bussines'],
      'customer': ['custmer', 'custome', 'customr'],
      'service': ['servce', 'servic', 'servise'],
      'product': ['prodct', 'produc', 'produt'],
      'company': ['compny', 'comapny', 'comany'],
      'price': ['pric', 'prie', 'pricce'],
      'quality': ['qulity', 'qualty', 'qality'],
      'support': ['suport', 'suppot', 'supprt'],
      'contact': ['contct', 'contat', 'contac'],
      'phone': ['phne', 'phon', 'pone'],
      'email': ['emal', 'emai', 'emial']
    };
    
    const lowerWord = word.toLowerCase();
    if (commonMistakes[lowerWord]) {
      variations.push(...commonMistakes[lowerWord].map(mistake => this.escapeRegex(mistake)));
    }
    
    return `(${variations.join('|')})`;
  }

  /**
   * Check if a word is a common word that doesn't add much meaning
   */
  isCommonWord(word) {
    const commonWords = [
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'you', 'i', 'me', 'my',
      'we', 'us', 'our', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
      'hello', 'hi', 'how', 'are', 'listening', 'talking', 'please', 'thank', 'thanks',
      'yes', 'no', 'ok', 'okay', 'sure', 'alright', 'good', 'bad', 'great', 'nice',
      'very', 'really', 'quite', 'just', 'only', 'also', 'too', 'so', 'then', 'now',
      'here', 'there', 'where', 'when', 'why', 'what', 'who', 'which', 'whose'
    ];
    
    return commonWords.includes(word.toLowerCase());
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
