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

// --- Check if email already exists ---
router.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Check if email already exists in Firebase
    try {
      await adminAuth.getUserByEmail(email);
      return res.status(400).json({ 
        error: "Email already in use. Please use a different email or try logging in." 
      });
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Email doesn't exist, it's available
        return res.json({ 
          success: true, 
          message: "Email is available" 
        });
      } else {
        // Some other error occurred
        throw error;
      }
    }
  } catch (e) {
    console.error('Error checking email:', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- Send verification code to email - Optimized ---
router.post("/send-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Optimized: Parallel email check and code generation
    const [emailCheckResult, verificationCode] = await Promise.allSettled([
      adminAuth.getUserByEmail(email).catch(error => {
        if (error.code === 'auth/user-not-found') return null;
        throw error;
      }),
      Promise.resolve(Math.floor(100000 + Math.random() * 900000).toString())
    ]);

    // Check if email already exists
    if (emailCheckResult.status === 'fulfilled' && emailCheckResult.value !== null) {
      return res.status(400).json({ 
        error: "Email already in use. Please use a different email or try logging in." 
      });
    }

    // Store code with timestamp (valid for 5 minutes)
    verificationCodes.set(email, {
      code: verificationCode.value,
      timestamp: Date.now(),
      attempts: 0
    });

    // Send verification email and wait for confirmation
    try {
      await sendVerificationEmail(email, verificationCode.value);
      console.log(`✅ Verification code sent to ${email}: ${verificationCode.value}`);
      
      return res.json({ 
        success: true, 
        message: "Verification code sent to your email"
      });
    } catch (emailError) {
      console.error('❌ Email sending failed:', emailError);
      console.error('📧 Email error details:', {
        message: emailError.message,
        code: emailError.code,
        response: emailError.response
      });
      
      // Check if it's a configuration error
      if (emailError.message.includes('Email service not configured')) {
        console.log(`🔑 FALLBACK - Email service not configured. Verification code for ${email}: ${verificationCode.value}`);
        console.log(`📧 Please configure EMAIL_USER and EMAIL_PASSWORD environment variables on Render`);
        
        return res.json({ 
          success: true, 
          message: "Email service not configured. Using fallback code.",
          fallbackCode: verificationCode.value,
          error: "Email service not configured. Please set EMAIL_USER and EMAIL_PASSWORD environment variables."
        });
      }
      
      // Other email errors
      console.log(`🔑 FALLBACK - Email sending failed. Verification code for ${email}: ${verificationCode.value}`);
      console.log(`📧 Email service failed, but code is stored and can be verified manually`);
      
      return res.json({ 
        success: true, 
        message: "Email sending failed. Using fallback code.",
        fallbackCode: verificationCode.value,
        error: emailError.message
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

// --- Set Firebase emailVerified to true after OTP verification ---
router.post("/set-email-verified", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "User ID is required" });

    // Update the user's emailVerified status in Firebase
    await adminAuth.updateUser(uid, {
      emailVerified: true
    });

    return res.json({ 
      success: true, 
      message: "Email verified status updated in Firebase" 
    });
  } catch (e) {
    console.error('Error setting emailVerified:', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- Test email service ---
router.post("/test-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    console.log(`🧪 Testing email service for: ${email}`);
    
    // Test email service
    const { testEmailService } = await import("../config/emailService.js");
    const isWorking = await testEmailService();
    
    if (isWorking) {
      return res.json({ 
        success: true, 
        message: "Email service is working properly" 
      });
    } else {
      return res.status(500).json({ 
        error: "Email service is not working. Please check configuration." 
      });
    }
  } catch (e) {
    console.error('Email service test failed:', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- Get user info by email (for debugging) ---
router.get("/user-info/:email", async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Get user by email
    const userRecord = await adminAuth.getUserByEmail(email);
    
    return res.json({
      uid: userRecord.uid,
      email: userRecord.email,
      emailVerified: userRecord.emailVerified,
      displayName: userRecord.displayName,
      createdAt: userRecord.metadata.creationTime
    });
  } catch (e) {
    console.error('Error getting user info:', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- Manually verify email for existing users (admin utility) ---
router.post("/verify-user-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Get user by email
    const userRecord = await adminAuth.getUserByEmail(email);
    
    // Update the user's emailVerified status
    await adminAuth.updateUser(userRecord.uid, {
      emailVerified: true
    });

    return res.json({ 
      success: true, 
      message: `Email verified for user: ${email}` 
    });
  } catch (e) {
    console.error('Error verifying user email:', e);
    return res.status(500).json({ error: e.message });
  }
});

// --- Update user profile ---
router.post("/update-profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization || "";
    const [, token] = authHeader.split(" ");
    if (!token) return res.status(401).json({ error: "Missing bearer token" });

    // Verify the user's token
    const decoded = await adminAuth.verifyIdToken(token, true);
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    // Validate phone number format
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(phoneNumber.replace(/\s/g, ''))) {
      return res.status(400).json({ error: "Please enter a valid phone number" });
    }

    // Update user profile in Firebase Auth (if needed)
    await adminAuth.updateUser(decoded.uid, {
      phoneNumber: phoneNumber.trim()
    });

    return res.json({ 
      success: true, 
      message: "Profile updated successfully",
      phoneNumber: phoneNumber.trim()
    });
  } catch (e) {
    console.error('Error updating profile:', e);
    if (e.code === 'auth/invalid-phone-number') {
      return res.status(400).json({ error: "Invalid phone number format" });
    }
    return res.status(500).json({ error: "Failed to update profile. Please try again." });
  }
});

export default router;
