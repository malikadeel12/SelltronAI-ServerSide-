import admin from "firebase-admin";
import dotenv from "dotenv";
// Ensure environment variables are loaded BEFORE reading process.env values
// This avoids issues where this module is imported before `dotenv.config()` in the entrypoint
dotenv.config();
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
  // Preferred: GOOGLE_APPLICATION_CREDENTIALS points to serviceAccountKey.json
//  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const inlineCreds = process.env.FIREBASE_ADMIN_CREDENTIALS;

  /*if (credentialsPath && fs.existsSync(credentialsPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    return admin.app();
  }
*/
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

  // Fallback: application default credentials (ADC)
  admin.initializeApp();
  return admin.app();
}

// Initialize on import for simplicity
initializeFirebaseAdmin();

// Export commonly used admin services
export const adminAuth = admin.auth();


