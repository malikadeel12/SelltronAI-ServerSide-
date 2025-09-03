import { Router } from "express";
import { adminAuth } from "../config/firebaseAdmin.js";
import { sendVerificationEmail } from "../config/emailService.js";

/**
 * Change Summary (MCP Context 7 Best Practices)
 * - Auth routes to help set/check roles using Firebase custom claims.
 * - Includes a helper endpoint to assign role to a user by UID (admin-only in real env).
 * - Added email verification endpoints for signup flow with real email sending.
 * Why: Needed for role-based route demos without separate admin UI yet.
 * Security Note: In production, protect the role-assignment endpoint by admin authentication.
 */

const router = Router();

// Store verification codes in memory (in production, use Redis or database)
const verificationCodes = new Map();

// --- Simple whoami using bearer token ---
router.get("/whoami", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    const decoded = await adminAuth.verifyIdToken(token, true);
    return res.json({ uid: decoded.uid, email: decoded.email, role: decoded.role || "user" });
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

// --- Assign role by UID (admin-only in production) ---
router.post("/assign-role", async (req, res) => {
  try {
    const { uid, role } = req.body;
    if (!uid || !role) return res.status(400).json({ error: "uid and role required" });
    await adminAuth.setCustomUserClaims(uid, { role });
    return res.json({ success: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Send verification code to email ---
router.post("/send-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with timestamp (valid for 5 minutes)
    verificationCodes.set(email, {
      code: verificationCode,
      timestamp: Date.now(),
      attempts: 0
    });

    // Send real verification email
    try {
      await sendVerificationEmail(email, verificationCode);
      console.log(`Verification code sent to ${email}: ${verificationCode}`);
      
      return res.json({ 
        success: true, 
        message: "Verification code sent to your email"
      });
    } catch (emailError) {
      // If email fails, remove the stored code and return error
      verificationCodes.delete(email);
      console.error('Email sending failed:', emailError);
      return res.status(500).json({ 
        error: "Failed to send verification email. Please try again." 
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Verify email code ---
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: "Email and code are required" });

    const storedData = verificationCodes.get(email);
    if (!storedData) {
      return res.status(400).json({ error: "No verification code found for this email" });
    }

    // Check if code is expired (5 minutes)
    if (Date.now() - storedData.timestamp > 5 * 60 * 1000) {
      verificationCodes.delete(email);
      return res.status(400).json({ error: "Verification code has expired" });
    }

    // Check if too many attempts
    if (storedData.attempts >= 3) {
      verificationCodes.delete(email);
      return res.status(400).json({ error: "Too many failed attempts. Please request a new code." });
    }

    // Verify code
    if (storedData.code !== code) {
      storedData.attempts += 1;
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Code is valid - remove from storage
    verificationCodes.delete(email);

    return res.json({ 
      success: true, 
      message: "Email verified successfully" 
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;


