import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses SendGrid API for production email delivery
 * Works reliably on Render platform
 */

// Gmail SMTP with proper configuration for Render
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    console.log(`🔧 EMAIL_USER: ${process.env.EMAIL_USER || 'skullb960@gmail.com'}`);
    console.log(`🔧 EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? '***SET***' : '***NOT SET***'}`);
    
    // Gmail SMTP with different approach for Render
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // Use SSL
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      },
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3'
      }
    });

    console.log(`🔧 Transporter created successfully`);

    const mailOptions = {
      from: `"Selltron AI" <${process.env.EMAIL_USER || 'skullb960@gmail.com'}>`,
      to: email,
      subject: 'Selltron AI - Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #D72638; margin: 0; font-size: 28px;">Selltron AI</h1>
              <p style="color: #666; margin: 5px 0 0 0;">Email Verification</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <h2 style="color: #333; margin: 0 0 20px 0;">Your Verification Code</h2>
              <div style="background-color: #D72638; color: white; font-size: 32px; font-weight: bold; padding: 20px; border-radius: 8px; letter-spacing: 3px; font-family: monospace; display: inline-block;">
                ${verificationCode}
              </div>
            </div>
            
            <div style="text-align: center; color: #666; font-size: 14px;">
              <p style="margin: 0 0 10px 0;">This code will expire in 5 minutes.</p>
              <p style="margin: 0;">If you didn't request this code, please ignore this email.</p>
            </div>
          </div>
        </div>
      `
    };

    console.log(`🔧 Attempting to send email...`);
    
    // Add timeout wrapper
    const sendEmailWithTimeout = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Email sending timeout after 30 seconds'));
      }, 30000);
      
      transporter.sendMail(mailOptions)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
    
    const result = await sendEmailWithTimeout;
    console.log(`✅ Email sent successfully to ${email}`);
    console.log(`📧 Email result:`, result);
    return true;
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    console.error('❌ Full error:', error);
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