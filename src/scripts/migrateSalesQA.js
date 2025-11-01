import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectToDatabase } from '../mongo/connection.js';
import SalesQA from '../models/SalesQA.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrateSalesQAData() {
  try {
    
    // Connect to MongoDB
    await connectToDatabase();
    
    // Read the salesQA.json file
    const salesQAPath = path.join(__dirname, '../salesQA/salesQA.json');
    const salesQAData = JSON.parse(fs.readFileSync(salesQAPath, 'utf8'));

    // Clear existing data (optional - remove this if you want to keep existing data)
    const existingCount = await SalesQA.countDocuments();
    if (existingCount > 0) {
      await SalesQA.deleteMany({});
    }
    
    // Insert data into MongoDB
    const insertedData = await SalesQA.insertMany(salesQAData);
    
    // Create text index for better search performance
    await SalesQA.collection.createIndex({
      "questions.question": "text",
      "category": "text",
      "description": "text"
    });
    
    // Get total questions count
    const totalQuestions = salesQAData.reduce((total, category) => {
      return total + category.questions.length;
    }, 0);

    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateSalesQAData();
}

export default migrateSalesQAData;

