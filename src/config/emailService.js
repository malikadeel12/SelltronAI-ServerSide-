import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Primary: Brevo (Sendinblue) - Best for deliverability
 * 300 emails/day FREE, Never blocked on Render, Never goes to spam
 */

// Brevo (Sendinblue) configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_BASE_URL = 'https://api.brevo.com/v3/smtp/email';

// Main and only email function
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email via Brevo to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    console.log(`🔧 BREVO_API_KEY: ${BREVO_API_KEY ? '***SET***' : '***NOT SET***'}`);
    
    if (!BREVO_API_KEY) {
      console.error('❌ BREVO_API_KEY not set! Please add BREVO_API_KEY to environment variables.');
      console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
      return false;
    }
    
    const emailData = {
      sender: {
        name: "Selltron AI",
        email: "noreply.selltronai@gmail.com"
      },
      to: [
        {
          email: email,
          name: "User"
        }
      ],
      subject: "Your Selltron AI Verification Code",
      htmlContent: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Code</title>
        </head>
        <body style="margin: 0; padding: 20px; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; padding: 30px;">
            
            <!-- Header -->
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #D72638; margin: 0; font-size: 24px; font-weight: bold;">Selltron AI</h1>
              <p style="color: #666666; margin: 5px 0 0 0; font-size: 16px;">Email Verification</p>
            </div>
            
            <!-- Content -->
            <div>
              <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 20px; text-align: center;">Your Verification Code</h2>
              
              <div style="text-align: center; margin: 30px 0;">
                <div style="background-color: #f8f9fa; border: 2px solid #D72638; border-radius: 8px; padding: 20px; display: inline-block;">
                  <span style="color: #D72638; font-size: 28px; font-weight: bold; letter-spacing: 3px; font-family: 'Courier New', monospace;">${verificationCode}</span>
                </div>
              </div>
              
              <div style="text-align: center; color: #666666; font-size: 14px; line-height: 1.5;">
                <p style="margin: 0 0 10px 0;">This verification code will expire in 5 minutes.</p>
                <p style="margin: 0;">If you didn't request this code, please ignore this email.</p>
              </div>
            </div>
            
            <!-- Footer -->
            <div style="margin-top: 30px; padding-top: 20px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="color: #666666; font-size: 12px; margin: 0;">© 2024 Selltron AI. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      textContent: `Your Selltron AI verification code is: ${verificationCode}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nBest regards,\nSelltron AI Team`
    };

    const response = await fetch(BREVO_BASE_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`✅ Brevo email sent successfully to ${email}`);
      console.log(`📧 Brevo response:`, result);
      return true;
    } else {
      const errorData = await response.text();
      console.error('❌ Brevo API error:', response.status, errorData);
      console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Brevo email failed:', error.message);
    console.error('❌ Full error:', error);
    console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
    return false;
  }
};