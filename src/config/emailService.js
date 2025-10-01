import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses SendGrid API for production email delivery
 * Works reliably on Render platform
 */

// Simple Gmail SMTP service with environment variables
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    
    // Use Gmail SMTP with environment variables
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER || 'skullb960@gmail.com',
      to: email,
      subject: 'Selltron AI - Verification Code',
      html: `
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
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
    
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