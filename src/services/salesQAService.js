import SalesQA from '../models/SalesQA.js';

class SalesQAService {
  constructor() {
    // Simple in-memory cache for frequently accessed questions
    this.cache = new Map();
    this.cacheMaxSize = 100; // Limit cache size
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get cached result if available
   */
  getCachedResult(query) {
    const cacheKey = this.normalizeQuery(query);
    const cached = this.cache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      console.log('🎯 Cache hit for query:', cacheKey);
      return cached.result;
    }
    
    if (cached) {
      this.cache.delete(cacheKey);
    }
    
    return null;
  }

  /**
   * Cache a result
   */
  setCachedResult(query, result) {
    const cacheKey = this.normalizeQuery(query);
    
    // Clean up old entries if cache is full
    if (this.cache.size >= this.cacheMaxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });
    
    console.log('💾 Cached result for query:', cacheKey);
  }

  /**
   * Clear cache for a specific query or all cache
   */
  clearCache(query = null) {
    if (query) {
      const cacheKey = this.normalizeQuery(query);
      this.cache.delete(cacheKey);
      console.log('🗑️ Cleared cache for query:', cacheKey);
    } else {
      this.cache.clear();
      console.log('🗑️ Cleared all cache');
    }
  }

  /**
   * Force clear cache and search again
   */
  async findMatchingQuestionForce(query) {
    console.log('🔄 Force searching without cache for:', query);
    this.clearCache(query);
    return await this.findMatchingQuestion(query);
  }

  /**
   * Clear all cache for fresh search
   */
  clearAllCache() {
    this.cache.clear();
    console.log('🗑️ Cleared all cache for fresh search');
  }

  /**
   * Search for matching questions in MongoDB - OPTIMIZED
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
      
      // Check cache first
      const cachedResult = this.getCachedResult(cleanQuery);
      if (cachedResult) {
        // Only use cached result if similarity is very high (exact or near-exact match)
        if (cachedResult.similarity && cachedResult.similarity >= 0.7) {
          console.log('🎯 Using high similarity cached result');
          return cachedResult;
        } else {
          console.log('🔄 Low similarity cached result, clearing cache and searching again');
          this.clearCache(cleanQuery);
        }
      }
      
      // Skip matching for casual conversation only (allow short queries for basic sales questions)
      if (this.isCasualConversation(cleanQuery)) {
        console.log('⏭️ Skipping match for casual conversation:', cleanQuery);
        return null;
      }
      
      // Try exact match first (fastest)
      let match = await this.exactMatch(cleanQuery);
      if (match) {
        console.log('🎯 Exact match found:', match.question);
        this.setCachedResult(cleanQuery, match);
        return match;
      }

      // Try partial match (fast)
      match = await this.partialMatch(cleanQuery);
      if (match) {
        console.log('🔍 Partial match found:', match.question);
        this.setCachedResult(cleanQuery, match);
        return match;
      }

      // Try text search (medium speed)
      match = await this.textSearch(cleanQuery);
      if (match) {
        console.log('📝 Text search match found:', match.question);
        this.setCachedResult(cleanQuery, match);
        return match;
      }

      // Only try expensive operations if no good match found yet
      // Try fuzzy matching for incomplete or similar queries (slower)
      match = await this.fuzzyMatch(cleanQuery);
      if (match) {
        console.log('🔍 Fuzzy match found:', match.question);
        this.setCachedResult(cleanQuery, match);
        return match;
      }

      // Last resort: fallback search (slowest)
      match = await this.fallbackSearch(cleanQuery);
      if (match) {
        console.log('🔄 Fallback match found:', match.question);
        this.setCachedResult(cleanQuery, match);
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
   * Exact match search - IMPROVED
   */
  async exactMatch(query) {
    // Try exact match with normalized query
    const normalizedQuery = this.normalizeQuery(query);
    
    // Create multiple variations for better matching
    const searchVariations = [
      query,
      normalizedQuery,
      query.replace(/\s+/g, '-'), // Convert spaces to hyphens
      query.replace(/-/g, ' '), // Convert hyphens to spaces
      query.replace(/\bpre\s*sales\b/gi, 'pre-sales'), // Handle pre sales and presales
      query.replace(/\bpost\s*sales\b/gi, 'post-sales'), // Handle post sales and postsales
      query.replace(/\bpresales\b/gi, 'pre-sales'), // Handle presales
      query.replace(/\bpostsales\b/gi, 'post-sales'), // Handle postsales
      // Handle verb tense variations
      query.replace(/\bwhat\s+happened\b/gi, 'what happens'), // "what happened" -> "what happens"
      query.replace(/\bwhat\s+will\s+happen\b/gi, 'what happens'), // "what will happen" -> "what happens"
      query.replace(/\bwhat\s+would\s+happen\b/gi, 'what happens'), // "what would happen" -> "what happens"
      // Handle sales-related variations
      query.replace(/\btell\s+me\s+about\s+sale\b/gi, 'about sales'), // "tell me about sale" -> "about sales"
      query.replace(/\btell\s+me\s+about\s+sales\b/gi, 'about sales'), // "tell me about sales" -> "about sales"
      // Handle competitor variations
      query.replace(/\bcompetitor\b/gi, 'competitor'), // Normalize competitor
      query.replace(/\bcompetitors\b/gi, 'competitor'), // Convert competitors to competitor
      query.replace(/\bcompetitor's\b/gi, 'competitor'), // Remove apostrophe
      query.replace(/\bcompetitors'\b/gi, 'competitor'), // Remove apostrophe
      // Handle "competitors" vs "competitor's" variations
      query.replace(/\bcompetitors\b/gi, 'competitor\'s'), // Convert "competitors" to "competitor's"
      query.replace(/\bcompetitor\b/gi, 'competitor\'s'), // Convert "competitor" to "competitor's"
      // Handle "can you" variations
      query.replace(/\bcan\s+you\b/gi, 'can you'), // Normalize "can you"
      query.replace(/\bdo\s+you\b/gi, 'can you'), // "do you" -> "can you"
      query.replace(/\bwill\s+you\b/gi, 'can you'), // "will you" -> "can you"
      // Handle "match" variations
      query.replace(/\bmatch\b/gi, 'match'), // Normalize match
      query.replace(/\bmatching\b/gi, 'match'), // "matching" -> "match"
      query.replace(/\bbeat\b/gi, 'match'), // "beat" -> "match"
      query.replace(/\bcompete\b/gi, 'match'), // "compete" -> "match"
    ];

    // Create more flexible regex patterns for competitor variations
    const flexiblePatterns = searchVariations.map(variation => {
      // Handle competitor variations more flexibly
      const flexibleVariation = variation
        .replace(/\bcompetitors\b/gi, '(competitors?|competitor\'s?)')
        .replace(/\bcompetitor\b/gi, '(competitor|competitors?)')
        .replace(/\bmatch\b/gi, '(match|matching)')
        .replace(/\boffer\b/gi, '(offer|offers)');
      
      return new RegExp(`^${this.escapeRegex(flexibleVariation)}$`, 'i');
    });
    
    const result = await SalesQA.findOne({
      $or: flexiblePatterns.map(pattern => ({
        "questions.question": { $regex: pattern }
      }))
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
   * Partial match search - looks for questions containing key words with fuzzy matching - OPTIMIZED
   */
  async partialMatch(query) {
    const words = query.split(' ').filter(word => word.length > 2);
    if (words.length === 0) return null;

    // Create search patterns with normalized variations
    const normalizedQuery = this.normalizeQuery(query);
    const normalizedWords = normalizedQuery.split(' ').filter(word => word.length > 2);
    
    // Create fewer, more targeted search patterns for better performance
    const searchPatterns = [
      // Original pattern with all words
      words.map(word => this.escapeRegex(word)).join('.*'),
      
      // Normalized pattern (handles pre-sales, post-sales, etc.)
      normalizedWords.map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern with key words only (remove common words) - most important
      words.filter(word => !this.isCommonWord(word)).map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern with at least 70% of the words (more forgiving)
      words.slice(0, Math.ceil(words.length * 0.7)).map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern for "what happens" variations
      query.replace(/\bwhat\s+happened\b/gi, 'what happens').split(' ').filter(word => word.length > 2).map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern for sales-related variations
      query.replace(/\btell\s+me\s+about\s+sale\b/gi, 'about sales').split(' ').filter(word => word.length > 2).map(word => this.escapeRegex(word)).join('.*'),
      
      // Pattern for competitor variations (competitors vs competitor's)
      words.map(word => {
        if (word.toLowerCase() === 'competitors') {
          return '(competitors?|competitor\'s?)';
        } else if (word.toLowerCase() === 'competitor') {
          return '(competitor|competitors?)';
        } else if (word.toLowerCase() === 'match') {
          return '(match|matching)';
        } else if (word.toLowerCase() === 'offer') {
          return '(offer|offers)';
        }
        return this.escapeRegex(word);
      }).join('.*')
    ];

    // Try each pattern and find the best match with early exit
    let bestMatch = null;
    let bestScore = 0;

    for (const pattern of searchPatterns) {
      const results = await SalesQA.find({
        "questions.question": { $regex: new RegExp(pattern, 'i') }
      }, {
        "questions": 1,
        category: 1,
        description: 1
      }).limit(20); // Limit results for better performance

      if (results && results.length > 0) {
        // Find the best matching question from all results
        for (const result of results) {
          for (const question of result.questions) {
        const similarity = this.calculateSimilarity(query, question.question);
        // Strict thresholds for exact matching
        let threshold = result.category === 'Basic Sales Questions' ? 0.2 : 0.6; // Higher threshold for exact matches
        
        // Check for exact word matches (like "competitor" + "offer")
        const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
        const questionWords = question.question.toLowerCase().split(' ').filter(word => word.length > 2);
        const exactWordMatches = queryWords.filter(word => questionWords.includes(word)).length;
        
        // Only lower threshold for very specific word matches (3+ words)
        if (exactWordMatches >= 3) {
          threshold = Math.min(threshold, 0.4); // Still high threshold
        }
        
        if (similarity > bestScore && similarity > threshold) {
          bestScore = similarity;
          bestMatch = {
            question: question.question,
            answers: question.answers,
            category: result.category,
            description: result.description,
            similarity: similarity
          };

          // Early exit if we find a very good match
          if (similarity > 0.7) {
            return bestMatch;
          }
        }
          }
        }
      }

      // Early exit if we found a decent match
      if (bestScore > 0.5) {
        break;
      }
    }

    return bestMatch;
  }

  /**
   * MongoDB text search with improved flexibility - OPTIMIZED
   */
  async textSearch(query) {
    try {
      // Create fewer, more targeted search variations for better performance
      const searchVariations = [
        query,
        // Split into key words only (most important)
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
          }).sort({ score: { $meta: "textScore" } }).limit(5); // Reduced limit for better performance

          if (results && results.length > 0) {
            // Find the best matching question from all results
            for (const result of results) {
              for (const question of result.questions) {
                const questionText = question.question.toLowerCase();
                const score = this.calculateSimilarity(query, questionText);
                
                // Check for exact word matches
                const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
                const questionWords = questionText.split(' ').filter(word => word.length > 2);
                const exactWordMatches = queryWords.filter(word => questionWords.includes(word)).length;
                
                // Strict threshold for exact matches
                let threshold = 0.6; // High threshold for exact matches
                if (exactWordMatches >= 3) {
                  threshold = 0.4; // Still high threshold even with word matches
                }
                
                if (score > bestScore && score > threshold) {
                  bestScore = score;
                  bestMatch = {
                    question: question.question,
                    answers: question.answers,
                    category: result.category,
                    description: result.description,
                    similarity: score
                  };

                  // Early exit if we find a very good match
                  if (score > 0.7) {
                    return bestMatch;
                  }
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
          }).limit(3); // Reduced limit

          if (regexResults && regexResults.length > 0) {
            for (const result of regexResults) {
              for (const question of result.questions) {
                const questionText = question.question.toLowerCase();
                const score = this.calculateSimilarity(query, questionText);
                if (score > bestScore && score > 0.15) {
                  bestScore = score;
                  bestMatch = {
                    question: question.question,
                    answers: question.answers,
                    category: result.category,
                    description: result.description,
                    similarity: score
                  };

                  // Early exit if we find a good match
                  if (score > 0.5) {
                    return bestMatch;
                  }
                }
              }
            }
          }
        }

        // Early exit if we found a decent match
        if (bestScore > 0.5) {
          break;
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
   * Fuzzy matching for incomplete or similar queries - OPTIMIZED
   */
  async fuzzyMatch(query) {
    try {
      // Use aggregation pipeline for better performance
      const pipeline = [
        { $unwind: "$questions" },
        { 
          $project: {
            question: "$questions.question",
            answers: "$questions.answers",
            category: 1,
            description: 1
          }
        },
        { $limit: 100 } // Limit to first 100 questions for performance
      ];

      const questions = await SalesQA.aggregate(pipeline);
      
      if (questions.length === 0) return null;

      let bestMatch = null;
      let bestScore = 0;
      const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);

      // Pre-calculate normalized query for efficiency
      const normalizedQuery = this.normalizeQuery(query);

      // Check each question for similarity with early exit
      for (const questionData of questions) {
        // Quick word overlap check first (much faster than full similarity)
        const questionWords = questionData.question.toLowerCase().split(' ').filter(word => word.length > 2);
        const wordOverlap = queryWords.filter(word => questionWords.includes(word)).length;
        
        // Skip if no word overlap at all
        if (wordOverlap === 0) continue;

        const similarity = this.calculateSimilarity(query, questionData.question);
        
        // Also try with normalized versions
        const normalizedQuestion = this.normalizeQuery(questionData.question);
        const normalizedSimilarity = this.calculateSimilarity(normalizedQuery, normalizedQuestion);
        
        const maxSimilarity = Math.max(similarity, normalizedSimilarity);
        
        // Strict threshold for exact matching
        const threshold = questionData.category === 'Basic Sales Questions' ? 0.2 : 0.6;
        if (maxSimilarity > bestScore && maxSimilarity > threshold) {
          bestScore = maxSimilarity;
          bestMatch = {
            question: questionData.question,
            answers: questionData.answers,
            category: questionData.category,
            description: questionData.description,
            similarity: maxSimilarity
          };

          // Early exit if we find a very good match
          if (maxSimilarity > 0.7) {
            break;
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
   * Fallback search with very relaxed criteria - OPTIMIZED
   */
  async fallbackSearch(query) {
    try {
      console.log('🔄 Trying fallback search for:', query);
      
      // Use aggregation pipeline with limit for better performance
      const pipeline = [
        { $unwind: "$questions" },
        { 
          $project: {
            question: "$questions.question",
            answers: "$questions.answers",
            category: 1,
            description: 1
          }
        },
        { $limit: 50 } // Even more limited for fallback
      ];

      const questions = await SalesQA.aggregate(pipeline);
      
      if (questions.length === 0) return null;

      let bestMatch = null;
      let bestScore = 0;
      const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);

      // Check each question for any similarity with early exit
      for (const questionData of questions) {
        // Quick word overlap check first
        const questionWords = questionData.question.toLowerCase().split(' ').filter(word => word.length > 2);
        const wordOverlap = queryWords.filter(word => questionWords.includes(word)).length;
        
        // Skip if no word overlap at all
        if (wordOverlap === 0) continue;

        const similarity = this.calculateSimilarity(query, questionData.question);
        
        // Strict threshold even for fallback
        if (similarity > bestScore && similarity > 0.6) {
          bestScore = similarity;
          bestMatch = {
            question: questionData.question,
            answers: questionData.answers,
            category: questionData.category,
            description: questionData.description,
            similarity: similarity
          };

          // Early exit if we find a decent match
          if (similarity > 0.3) {
            break;
          }
        }
      }

      if (bestMatch) {
        console.log(`🔄 Fallback found match with similarity: ${bestScore.toFixed(3)}`);
      }

      return bestMatch;
    } catch (error) {
      console.error('Fallback search error:', error);
      return null;
    }
  }

  /**
   * Calculate similarity between two strings with optimized algorithm
   */
  calculateSimilarity(str1, str2) {
    // Quick length check for early exit
    const len1 = str1.length;
    const len2 = str2.length;
    if (len1 === 0 || len2 === 0) return 0;
    
    // If strings are too different in length, likely not similar
    const lengthRatio = Math.min(len1, len2) / Math.max(len1, len2);
    if (lengthRatio < 0.3) return 0;
    
    // Normalize competitor variations before comparison
    const normalizedStr1 = str1.toLowerCase()
      .replace(/\bcompetitors\b/g, 'competitor')
      .replace(/\bcompetitor's\b/g, 'competitor')
      .replace(/\bmatching\b/g, 'match')
      .replace(/\boffers\b/g, 'offer');
    const normalizedStr2 = str2.toLowerCase()
      .replace(/\bcompetitors\b/g, 'competitor')
      .replace(/\bcompetitor's\b/g, 'competitor')
      .replace(/\bmatching\b/g, 'match')
      .replace(/\boffers\b/g, 'offer');
    
    const words1 = normalizedStr1.split(' ').filter(word => 
      word.length > 2 && !this.isCommonWord(word)
    );
    const words2 = normalizedStr2.split(' ').filter(word => 
      word.length > 2 && !this.isCommonWord(word)
    );
    
    // If no meaningful words left after filtering, return 0
    if (words1.length === 0 || words2.length === 0) {
      return 0;
    }
    
    // Quick word overlap check for early exit
    const intersection = words1.filter(word => words2.includes(word));
    if (intersection.length === 0) {
      // Check for substring match as last resort
      const str1Lower = str1.toLowerCase();
      const str2Lower = str2.toLowerCase();
      if (str1Lower.includes(str2Lower) || str2Lower.includes(str1Lower)) {
        return 0.3; // Substring match bonus
      }
      return 0;
    }
    
    // Calculate Jaccard similarity (intersection over union) - main similarity measure
    const union = [...new Set([...words1, ...words2])];
    const jaccardSimilarity = intersection.length / union.length;
    
    // Early exit if jaccard similarity is already very high
    if (jaccardSimilarity > 0.8) {
      return Math.min(1, jaccardSimilarity + 0.1); // Small bonus for high similarity
    }
    
    // Calculate word order similarity (bonus for words in similar positions) - simplified
    let orderBonus = 0;
    const minLength = Math.min(words1.length, words2.length);
    const maxOrderBonus = Math.min(minLength * 0.05, 0.2); // Cap order bonus
    
    for (let i = 0; i < Math.min(minLength, 5); i++) { // Limit to first 5 words for performance
      if (words1[i] === words2[i]) {
        orderBonus += 0.1;
      }
    }
    
    // Calculate substring similarity (for partial matches) - simplified
    let substringBonus = 0;
    const str1Lower = str1.toLowerCase();
    const str2Lower = str2.toLowerCase();
    
    // Check if one string contains the other as substring
    if (str1Lower.includes(str2Lower) || str2Lower.includes(str1Lower)) {
      substringBonus = 0.2; // Reduced bonus for substring matches
    }
    
    // Combine all similarity measures
    const totalSimilarity = Math.min(1, jaccardSimilarity + orderBonus + substringBonus);
    
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
      .replace(/\bpre\s*sales\b/g, 'pre-sales') // Convert "pre sales" and "presales" to "pre-sales"
      .replace(/\bpost\s*sales\b/g, 'post-sales') // Convert "post sales" and "postsales" to "post-sales"
      .replace(/\bco\s*founder\b/g, 'co-founder') // Convert "co founder" and "cofounder" to "co-founder"
      .replace(/\bco\s*founder\b/g, 'co-founder') // Convert "co founder" and "cofounder" to "co-founder"
      // Handle verb tense variations
      .replace(/\bwhat\s+happened\b/g, 'what happens') // Convert "what happened" to "what happens"
      .replace(/\bwhat\s+will\s+happen\b/g, 'what happens') // Convert "what will happen" to "what happens"
      .replace(/\bwhat\s+would\s+happen\b/g, 'what happens') // Convert "what would happen" to "what happens"
      // Handle sales-related variations
      .replace(/\btell\s+me\s+about\s+sale\b/g, 'about sales') // Convert "tell me about sale" to "about sales"
      .replace(/\btell\s+me\s+about\s+sales\b/g, 'about sales') // Convert "tell me about sales" to "about sales"
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
      'writing': ['written', 'document', 'documentation', 'email', 'text', 'paper', 'papers'],
      'send': ['sending', 'email', 'provide', 'give', 'share', 'deliver', 'forward'],
      'everything': ['all', 'complete', 'full', 'entire', 'total', 'whole'],
      'information': ['info', 'details', 'data', 'facts', 'material', 'content'],
      'document': ['documents', 'paper', 'papers', 'file', 'files', 'report', 'summary'],
      'written': ['writing', 'text', 'documentation', 'email', 'printed', 'formal'],
      'talk': ['speak', 'discuss', 'chat', 'conversation', 'call'],
      'online': ['internet', 'web', 'website', 'digital', 'web-based'],
      'checking': ['check', 'look', 'search', 'find', 'verify'],
      'instead': ['rather', 'alternative', 'option', 'choice'],
      'should': ['shall', 'would', 'could', 'must', 'need'],
      'you': ['your', 'yours', 'yourself'],
      'me': ['my', 'myself', 'i'],
      'can': ['could', 'able', 'possible', 'capable'],
      'competitor': ['competitors', 'rival', 'rivals', 'opponent', 'opponents', 'competition', 'competing'],
      'competitors': ['competitor', 'rival', 'rivals', 'opponent', 'opponents', 'competition', 'competing'],
      'match': ['matches', 'matching', 'equal', 'equals', 'meet', 'meets', 'beat', 'beats', 'compete', 'competing'],
      'offer': ['offers', 'deal', 'deals', 'proposal', 'proposals', 'quote', 'quotes', 'price', 'pricing'],
      // Sales-specific synonyms
      'sale': ['sales', 'selling', 'sell', 'sells', 'sold', 'purchase', 'buy', 'transaction'],
      'sales': ['sale', 'selling', 'sell', 'sells', 'sold', 'purchases', 'buying', 'transactions'],
      'selling': ['sale', 'sales', 'sell', 'sells', 'sold', 'pitching', 'presenting'],
      'sell': ['sale', 'sales', 'selling', 'sells', 'sold', 'pitch', 'present', 'offer'],
      'process': ['procedure', 'method', 'approach', 'system', 'workflow'],
      'customer': ['client', 'buyer', 'prospect', 'lead', 'purchaser'],
      'client': ['customer', 'buyer', 'prospect', 'lead', 'purchaser'],
      'buyer': ['customer', 'client', 'prospect', 'lead', 'purchaser'],
      'product': ['products', 'service', 'services', 'solution', 'solutions', 'offer', 'offering'],
      'service': ['services', 'product', 'products', 'solution', 'solutions', 'offer', 'offering'],
      'price': ['pricing', 'cost', 'costs', 'fee', 'fees', 'rate', 'rates', 'charge', 'charges'],
      'cost': ['price', 'pricing', 'fee', 'fees', 'rate', 'rates', 'charge', 'charges', 'costs'],
      'value': ['worth', 'benefit', 'benefits', 'advantage', 'advantages', 'merit', 'merits'],
      'benefit': ['value', 'worth', 'advantage', 'merit', 'benefits', 'advantages', 'merits'],
      'training': ['education', 'learning', 'development', 'coaching', 'mentoring', 'teaching'],
      'skill': ['skills', 'ability', 'abilities', 'talent', 'talents', 'capability', 'capabilities'],
      'technique': ['techniques', 'method', 'methods', 'approach', 'approaches', 'strategy', 'strategies'],
      'strategy': ['strategies', 'approach', 'approaches', 'method', 'methods', 'plan', 'plans'],
      'goal': ['goals', 'objective', 'objectives', 'target', 'targets', 'aim', 'aims'],
      'target': ['targets', 'goal', 'goals', 'objective', 'objectives', 'aim', 'aims'],
      'result': ['results', 'outcome', 'outcomes', 'consequence', 'consequences', 'effect', 'effects'],
      'success': ['successful', 'achievement', 'achievements', 'accomplishment', 'accomplishments'],
      'help': ['helps', 'helping', 'assist', 'assists', 'assisting', 'support', 'supports', 'supporting'],
      'assist': ['help', 'helps', 'helping', 'support', 'supports', 'supporting', 'aid', 'aids', 'aiding'],
      'support': ['help', 'helps', 'helping', 'assist', 'assists', 'assisting', 'aid', 'aids', 'aiding']
    };
    
    return synonyms[word.toLowerCase()] || [];
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
        console.log('❌ No queries provided or empty array');
        return [];
      }

      console.log('🔍 Searching for multiple questions:', queries);
      const matches = [];

      for (const query of queries) {
        if (query && typeof query === 'string' && query.trim().length > 0) {
          console.log(`🔍 Processing query: "${query.trim()}"`);
          const match = await this.findMatchingQuestion(query.trim());
          if (match) {
            matches.push({
              originalQuery: query.trim(),
              matchedQuestion: match.question,
              answers: match.answers,
              category: match.category,
              description: match.description,
              similarity: match.similarity || 0
            });
            console.log(`✅ Found match for: "${query.trim()}" -> "${match.question}" (similarity: ${match.similarity || 'N/A'})`);
          } else {
            console.log(`❌ No match found for: "${query.trim()}"`);
          }
        } else {
          console.log(`⚠️ Skipping invalid query: "${query}"`);
        }
      }

      console.log(`🎯 Total matches found: ${matches.length}/${queries.length}`);
      if (matches.length === 0) {
        console.log('⚠️ No matches found - this will trigger GPT fallback');
      }
      return matches;
    } catch (error) {
      console.error('❌ Error in findMultipleMatchingQuestions:', error);
      console.error('Stack trace:', error.stack);
      return [];
    }
  }

  /**
   * Find most related questions for GPT analysis when no exact match found
   * @param {string} query - The user's query
   * @returns {Array<Object>} - Array of related questions for GPT context
   */
  async findRelatedQuestionsForGPT(query) {
    try {
      console.log('🔍 Finding related questions for GPT analysis:', query);
      
      // Get more questions from database for better context
      const pipeline = [
        { $unwind: "$questions" },
        { 
          $project: {
            question: "$questions.question",
            answers: "$questions.answers",
            category: 1,
            description: 1
          }
        },
        { $limit: 50 } // Increased from 20 to 50 for better coverage
      ];

      const sampleQuestions = await SalesQA.aggregate(pipeline);
      
      if (sampleQuestions.length === 0) {
        console.log('❌ No sample questions found for GPT context');
        return [];
      }

      // Find the most related questions based on similarity
      const relatedQuestions = [];
      const queryWords = query.toLowerCase().split(' ').filter(word => word.length > 2);
      const normalizedQuery = this.normalizeQuery(query);

      for (const questionData of sampleQuestions) {
        // Quick word overlap check
        const questionWords = questionData.question.toLowerCase().split(' ').filter(word => word.length > 2);
        const wordOverlap = queryWords.filter(word => questionWords.includes(word)).length;
        
        // Also check for synonym matches
        let synonymOverlap = 0;
        for (const word of queryWords) {
          const synonyms = this.getSynonyms(word);
          for (const synonym of synonyms) {
            if (questionWords.includes(synonym)) {
              synonymOverlap++;
              break;
            }
          }
        }
        
        const totalOverlap = wordOverlap + synonymOverlap;
        
        if (totalOverlap > 0) {
          const similarity = this.calculateSimilarity(query, questionData.question);
          const normalizedSimilarity = this.calculateSimilarity(normalizedQuery, this.normalizeQuery(questionData.question));
          const maxSimilarity = Math.max(similarity, normalizedSimilarity);
          
          // Lower threshold for GPT context and bonus for word overlap
          const bonusScore = totalOverlap * 0.1;
          const finalScore = maxSimilarity + bonusScore;
          
          if (finalScore > 0.05) { // Even lower threshold for GPT context
            relatedQuestions.push({
              question: questionData.question,
              answers: questionData.answers,
              category: questionData.category,
              description: questionData.description,
              similarity: finalScore
            });
          }
        }
      }

      // Sort by similarity and return top 8 most related (increased from 5)
      const topRelated = relatedQuestions
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 8);

      console.log(`🎯 Found ${topRelated.length} related questions for GPT context`);
      if (topRelated.length > 0) {
        console.log(`📊 Top related question: "${topRelated[0].question}" (similarity: ${topRelated[0].similarity.toFixed(3)})`);
      }
      return topRelated;
    } catch (error) {
      console.error('❌ Error in findRelatedQuestionsForGPT:', error);
      return [];
    }
  }
}

export default new SalesQAService();
