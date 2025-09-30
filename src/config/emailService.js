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
  // Direct email credentials (no environment variables needed)
  const emailUser = 'skullb960@gmail.com';
  const emailPassword = 'kprjldoulepjaoml';
  
  console.log(`📧 Using email: ${emailUser}`);
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPassword
    }
  });

  return transporter;
};

// Optimized: Lightweight email template for faster sending
const getOptimizedEmailTemplate = (verificationCode) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email Verification</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f5f5f5;">
  <div style="max-width:600px;margin:20px auto;background-color:white;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
    <div style="background-color:#D72638;color:white;padding:20px;text-align:center;">
      <h1 style="margin:0;font-size:24px;">Selltron AI</h1>
      <p style="margin:5px 0 0 0;opacity:0.9;">Email Verification</p>
    </div>
    <div style="padding:30px 20px;text-align:center;">
      <h2 style="color:#333;margin:0 0 20px 0;">Your Verification Code</h2>
      <div style="background-color:#FFD700;color:#000;font-size:28px;font-weight:bold;padding:15px;border-radius:8px;letter-spacing:3px;font-family:monospace;display:inline-block;margin:10px 0;">
        ${verificationCode}
      </div>
      <p style="color:#666;margin:15px 0 0 0;font-size:14px;">This code will expire in 5 minutes</p>
    </div>
    <div style="background-color:#f8f9fa;padding:15px;text-align:center;border-top:1px solid #eee;">
      <p style="color:#666;margin:0;font-size:12px;">If you didn't request this code, please ignore this email.</p>
      <p style="color:#666;margin:5px 0 0 0;font-size:12px;">© 2025 Sell Predator. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

// Simple email service - no timeouts
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    
    // Simple Gmail SMTP - no timeout settings
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'skullb960@gmail.com',
        pass: 'kprjldoulepjaoml'
      }
    });

    const mailOptions = {
      from: 'skullb960@gmail.com',
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

    // Send email - no timeout
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
    const transporter = createTransporter();
    await transporter.verify();
    console.log('Email service is ready');
    return true;
  } catch (error) {
    console.error('Email service test failed:', error);
    return false;
  }
};
