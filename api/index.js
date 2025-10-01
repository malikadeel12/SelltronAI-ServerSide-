// Import the main server application
import app from "../src/server.js";

// Add error handling for Vercel
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Export the app for Vercel
export default app;
