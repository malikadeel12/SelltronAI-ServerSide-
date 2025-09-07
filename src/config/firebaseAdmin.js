import admin from "firebase-admin";
import dotenv from "dotenv";
// Ensure environment variables are loaded BEFORE reading process.env values
// This avoids issues where this module is imported before `dotenv.config()` in the entrypoint
dotenv.config({ path: '.env.local' });
import fs from "fs";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Initializes Firebase Admin using either GOOGLE_APPLICATION_CREDENTIALS path
 *   or FIREBASE_ADMIN_CREDENTIALS (base64 or JSON string) env variable.
 * Why: Required to verify ID tokens and manage custom role claims.
 * Related: `src/middleware/auth.js` uses admin.auth() to verify tokens.
 * Update: Preloaded dotenv here to guarantee env vars are available on import.
 */

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  // --- Credential Resolution ---
  // First try: GOOGLE_APPLICATION_CREDENTIALS environment variable
//  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  // Second try: Default service account key file location
  const defaultCredentialsPath = "./src/firebasekey/serviceAccountKey.json";
  
  // Third try: Inline credentials from environment
  const inlineCreds = process.env.FIREBASE_ADMIN_CREDENTIALS;

  // Try credentials path first
  /*if (credentialsPath && fs.existsSync(credentialsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin.app();
  }
    */
  
  // Try default path
  if (fs.existsSync(defaultCredentialsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(defaultCredentialsPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin.app();
  }

  // Try inline credentials
  if (inlineCreds) {
    // Support base64 or raw JSON string
    let jsonString = inlineCreds;
    try {
      // Try base64 decode first
      jsonString = Buffer.from(inlineCreds, "base64").toString("utf8");
    } catch (_) {
      // Not base64; treat as raw JSON
    }
    const serviceAccount = JSON.parse(jsonString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin.app();
  }

  // Fallback: application default credentials (ADC) - this is what's causing the error
  console.error("No Firebase credentials found! Please set up service account key.");
  throw new Error("Firebase Admin SDK not properly configured. Please check your service account key file.");
}

// Initialize on import for simplicity
initializeFirebaseAdmin();

// Export commonly used admin services
export const adminAuth = admin.auth();


