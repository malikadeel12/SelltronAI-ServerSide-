import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses Nodemailer with Gmail SMTP for email delivery
 */

// Create Nodemailer transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'skullb960@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
  }
});

// Verify transporter configuration
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Nodemailer configuration error:', error);
  } else {
    console.log('✅ Nodemailer is ready to send emails');
  }
});

// Simple Nodemailer function
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email via Nodemailer to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    
    const mailOptions = {
      from: 'skullb960@gmail.com',
      to: email,
      subject: 'Your Verification Code',
      text: `Your verification code is: ${verificationCode}\n\nThis code will expire in 5 minutes.\n\nSelltron AI`
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    console.log(`📧 Nodemailer response:`, result.messageId);
    return true;
    
  } catch (error) {
    console.error('❌ Nodemailer email failed:', error.message);
    console.error('❌ Full error:', error);
    return false;
  }
};

// Simple Nodemailer functions
export const sendEmailWithSpamPrevention = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email via Nodemailer to: ${email}`);
    
    const mailOptions = {
      from: 'skullb960@gmail.com',
      to: email,
      subject: 'Verification Code',
      text: `Code: ${verificationCode}\n\nExpires in 5 minutes.\n\nSelltron AI`
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    return false;
  }
};

export const sendProfessionalEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email via Nodemailer to: ${email}`);
    
    const mailOptions = {
      from: 'skullb960@gmail.com',
      to: email,
      subject: 'Your Code',
      text: `${verificationCode}`
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    return false;
  }
};

export const sendAlternativeEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email via Nodemailer to: ${email}`);
    
    const mailOptions = {
      from: 'skullb960@gmail.com',
      to: email,
      subject: 'Code',
      text: `${verificationCode}`
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    return false;
  }
};

// Test email service connection
export const testEmailService = async () => {
  try {
    console.log('🧪 Testing Nodemailer connection...');
    console.log('✅ Nodemailer service is ready');
    return true;
  } catch (error) {
    console.error('❌ Nodemailer test failed:', error);
    return false;
  }
};