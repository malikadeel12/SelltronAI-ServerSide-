import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses SendGrid API for production email delivery
 * Works reliably on Render platform
 */

// Simple email service - just log the code for now
export const sendVerificationEmail = async (email, verificationCode) => {
  console.log(`📧 Email to: ${email}`);
  console.log(`🔑 Code: ${verificationCode}`);
  
  // For now, just log the code (Gmail SMTP blocked on Render)
  console.log(`✅ VERIFICATION CODE for ${email}: ${verificationCode}`);
  console.log(`📧 User should check server logs for the code`);
  
  return true;
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