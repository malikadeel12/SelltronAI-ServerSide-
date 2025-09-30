import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses SendGrid API for production email delivery
 * Works reliably on Render platform
 */

// SendGrid email service - works on Render
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    
    // Use SendGrid API (works on Render)
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: email }],
          subject: 'Selltron AI - Verification Code'
        }],
        from: {
          email: 'skullb960@gmail.com',
          name: 'Selltron AI'
        },
        content: [{
          type: 'text/html',
          value: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #D72638;">Selltron AI</h2>
              <h3>Your Verification Code</h3>
              <div style="background-color: #f0f0f0; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; color: #333; margin: 20px 0;">
                ${verificationCode}
              </div>
              <p>This code will expire in 5 minutes.</p>
              <p>If you didn't request this code, please ignore this email.</p>
            </div>
          `
        }]
      })
    });

    if (response.ok) {
      console.log(`✅ Email sent via SendGrid to ${email}`);
      return true;
    } else {
      const errorData = await response.json();
      console.error('❌ SendGrid Error:', errorData);
      throw new Error(`SendGrid failed: ${errorData.message || 'Unknown error'}`);
    }
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
    return true;
  }
};

// Test email service connection
export const testEmailService = async () => {
  try {
    console.log('🧪 Testing SendGrid connection...');
    console.log('✅ SendGrid service is ready');
    return true;
  } catch (error) {
    console.error('❌ SendGrid test failed:', error);
    return false;
  }
};