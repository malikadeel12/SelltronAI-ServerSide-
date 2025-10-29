import mongoose from "mongoose";

// Schema for individual answer options
const answerSchema = new mongoose.Schema({
  option: {
    type: String,
    required: true,
    enum: ['A', 'B', 'C']
  },
  text: {
    type: String,
    required: true
  }
});

// Schema for individual questions
const questionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true,
    index: true // Add index for faster searching
  },
  answers: [answerSchema]
});

// Main schema for sales Q&A categories
const salesQASchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    index: true
  },
  description: {
    type: String,
    required: true
  },
  questions: [questionSchema]
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Create text index for full-text search on questions
salesQASchema.index({
  "questions.question": "text",
  "category": "text",
  "description": "text"
});

// Create compound index for better performance
salesQASchema.index({ category: 1, "questions.question": 1 });

const SalesQA = mongoose.model('SalesQA', salesQASchema);

export default SalesQA;

