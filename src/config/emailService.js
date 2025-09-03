import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses Nodemailer with Gmail SMTP for sending verification codes
 * In production, consider using SendGrid, AWS SES, or other email services
 */

// Create transporter for Gmail SMTP
const createTransporter = () => {
  // For Gmail, you need to:
  // 1. Enable 2-factor authentication
  // 2. Generate an App Password
  // 3. Use that App Password instead of your regular password
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'adeelriaz384@gmail.com',
      pass: process.env.EMAIL_PASSWORD || 'xysbispcrcqwyktx'
    }
  });

  return transporter;
};

// Send verification email
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'adeelriaz384@gmail.com',
      to: email,
      subject: 'Selltron AI - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #D72638; margin: 0; font-size: 28px;">Selltron AI</h1>
              <p style="color: #666; margin: 10px 0 0 0;">Email Verification</p>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
              <h2 style="color: #333; margin: 0 0 15px 0; font-size: 18px;">Your Verification Code</h2>
              <div style="background-color: #FFD700; color: #000; font-size: 32px; font-weight: bold; padding: 15px; border-radius: 8px; letter-spacing: 5px; font-family: monospace;">
                ${verificationCode}
              </div>
              <p style="color: #666; margin: 15px 0 0 0; font-size: 14px;">
                This code will expire in 5 minutes
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #666; margin: 0; font-size: 14px;">
                If you didn't request this code, please ignore this email.
              </p>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 14px;">
                © 2025 Sell Predator. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log(`Verification email sent to ${email}: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error('Failed to send verification email');
  }
};

// Test email service connection
export const testEmailService = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email service is ready');
    return true;
  } catch (error) {
    console.error('Email service test failed:', error);
    return false;
  }
};
