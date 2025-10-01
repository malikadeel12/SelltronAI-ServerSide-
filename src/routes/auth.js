import { Router } from "express";
import { adminAuth } from "../config/firebaseAdmin.js";
import { sendVerificationEmail, sendVerificationEmailAlternative, sendVerificationEmailDirect } from "../config/emailService.js";

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
    const codeData = {
      code: verificationCode.value,
      timestamp: Date.now(),
      attempts: 0
    };
    verificationCodes.set(email, codeData);
    console.log(`💾 Stored verification code for ${email}:`, codeData);
    console.log(`📊 Total codes in memory: ${verificationCodes.size}`);

    // Send verification email with fallback (async - don't wait)
    sendVerificationEmail(email, verificationCode.value)
      .then(() => {
        console.log(`✅ Email sent successfully to ${email}`);
      })
      .catch(async (error) => {
        console.error(`❌ Primary email sending failed for ${email}:`, error.message);
        console.log(`🔄 Trying alternative email service...`);
        
        // Try alternative email service
        try {
          const alternativeResult = await sendVerificationEmailAlternative(email, verificationCode.value);
          if (alternativeResult) {
            console.log(`✅ Alternative email sent successfully to ${email}`);
          } else {
            console.error(`❌ Alternative email also failed for ${email}`);
            // Try third fallback
            try {
              const directResult = await sendVerificationEmailDirect(email, verificationCode.value);
              if (directResult) {
                console.log(`✅ Direct email sent successfully to ${email}`);
              } else {
                console.error(`❌ All email services failed for ${email}`);
              }
            } catch (directError) {
              console.error(`❌ Direct email service failed:`, directError.message);
            }
          }
        } catch (altError) {
          console.error(`❌ Alternative email service failed:`, altError.message);
        }
      });
    
    return res.json({ 
      success: true, 
      message: "Verification code generated successfully"
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Verify email code ---
router.post("/verify-email", async (req, res) => {
  try {
    const { email, code } = req.body;
    console.log(`🔍 Verifying email code for: ${email}, code: ${code}`);
    
    if (!email || !code) return res.status(400).json({ error: "Email and code are required" });

    const storedData = verificationCodes.get(email);
    console.log(`📦 Stored data for ${email}:`, storedData);
    console.log(`📊 Total codes in memory: ${verificationCodes.size}`);
    
    if (!storedData) {
      console.log(`❌ No verification code found for email: ${email}`);
      return res.status(400).json({ error: "No verification code found for this email" });
    }

    // Check if code is expired (5 minutes)
    const timeDiff = Date.now() - storedData.timestamp;
    console.log(`⏰ Time since code generation: ${Math.round(timeDiff / 1000)} seconds`);
    
    if (timeDiff > 5 * 60 * 1000) {
      console.log(`⏰ Code expired for ${email}`);
      verificationCodes.delete(email);
      return res.status(400).json({ error: "Verification code has expired" });
    }

    // Check if too many attempts
    if (storedData.attempts >= 3) {
      console.log(`🚫 Too many attempts for ${email}`);
      verificationCodes.delete(email);
      return res.status(400).json({ error: "Too many failed attempts. Please request a new code." });
    }

    // Verify code
    console.log(`🔍 Comparing codes: stored="${storedData.code}" vs provided="${code}"`);
    if (storedData.code !== code) {
      storedData.attempts += 1;
      console.log(`❌ Invalid code for ${email}, attempt ${storedData.attempts}`);
      return res.status(400).json({ error: "Invalid verification code" });
    }

    // Code is valid - remove from storage
    console.log(`✅ Code verified successfully for ${email}`);
    verificationCodes.delete(email);

    return res.json({ 
      success: true, 
      message: "Email verified successfully" 
    });
  } catch (e) {
    console.error('❌ Verification error:', e);
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

// --- Debug email configuration ---
router.get("/debug-email", async (req, res) => {
  try {
    const emailUser = process.env.EMAIL_USER;
    const emailPassword = process.env.EMAIL_PASSWORD;
    
    return res.json({
      emailConfigured: !!(emailUser && emailPassword),
      emailUser: emailUser ? `${emailUser.substring(0, 3)}***@gmail.com` : 'Not set',
      hasPassword: !!emailPassword,
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// --- Test email service ---
router.post("/test-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    console.log(`🧪 Testing email service for: ${email}`);
    
    // Test email service connection
    const { testEmailService, sendVerificationEmail } = await import("../config/emailService.js");
    const isWorking = await testEmailService();
    
    if (isWorking) {
      // Try to send a test email
      try {
        const testCode = "123456";
        await sendVerificationEmail(email, testCode);
        return res.json({ 
          success: true, 
          message: `Test email sent successfully to ${email}. Check your inbox and spam folder.`,
          testCode: testCode
        });
      } catch (emailError) {
        console.error('Test email sending failed:', emailError);
        return res.status(500).json({ 
          error: `Email service connection works but sending failed: ${emailError.message}` 
        });
      }
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
