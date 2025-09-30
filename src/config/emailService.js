import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses Nodemailer with Gmail SMTP for sending verification codes
 * In production, consider using SendGrid, AWS SES, or other email services
 */

// Create transporter for Gmail SMTP with production optimizations
const createTransporter = () => {
  // Use environment variables with fallback to hardcoded values
  const emailUser = process.env.EMAIL_USER || 'skullb960@gmail.com';
  const emailPassword = process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml';
  
  console.log(`📧 Using email: ${emailUser}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: emailUser,
      pass: emailPassword
    },
    // Production optimizations for Render
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 5000,    // 5 seconds
    socketTimeout: 10000,     // 10 seconds
    pool: true,               // Use connection pooling
    maxConnections: 5,        // Max connections in pool
    maxMessages: 100,         // Max messages per connection
    rateLimit: 10,            // Max 10 emails per second
    // Retry configuration
    retryDelay: 2000,         // 2 seconds between retries
    maxRetries: 3             // Max 3 retries
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

// Send verification email - Optimized for production with timeout handling
export const sendVerificationEmail = async (email, verificationCode) => {
  let transporter;
  
  try {
    console.log(`📧 Attempting to send verification email to: ${email}`);
    console.log(`🔑 Verification code: ${verificationCode}`);
    
    transporter = createTransporter();
    
    // Test connection first with timeout
    console.log(`🔍 Testing email connection...`);
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 10000)
      )
    ]);
    console.log(`✅ Email connection verified`);
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'skullb960@gmail.com',
      to: email,
      subject: 'Selltron AI - Email Verification Code',
      html: getOptimizedEmailTemplate(verificationCode)
    };

    // Send email with timeout
    console.log(`📤 Sending email...`);
    const result = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Send timeout')), 15000)
      )
    ]);
    
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Email sending failed:', error.message);
    console.error('📧 Error details:', {
      code: error.code,
      response: error.response,
      command: error.command
    });
    
    // Close transporter if it exists
    if (transporter) {
      try {
        transporter.close();
      } catch (closeError) {
        console.error('Error closing transporter:', closeError);
      }
    }
    
    throw new Error(`Failed to send verification email: ${error.message}`);
  }
};

// Test email service connection with timeout
export const testEmailService = async () => {
  let transporter;
  
  try {
    console.log('🧪 Testing email service connection...');
    transporter = createTransporter();
    
    // Test with timeout
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Test timeout')), 10000)
      )
    ]);
    
    console.log('✅ Email service is ready');
    return true;
  } catch (error) {
    console.error('❌ Email service test failed:', error.message);
    console.error('📧 Test error details:', {
      code: error.code,
      response: error.response
    });
    return false;
  } finally {
    // Close transporter
    if (transporter) {
      try {
        transporter.close();
      } catch (closeError) {
        console.error('Error closing test transporter:', closeError);
      }
    }
  }
};
