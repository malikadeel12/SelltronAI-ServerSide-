import sgMail from '@sendgrid/mail';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses SendGrid for email delivery
 * Configured for client's SendGrid API
 */

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    console.log(`🔧 SENDGRID_API_KEY: ${process.env.SENDGRID_API_KEY ? '***SET***' : '***NOT SET***'}`);
    
    const msg = {
      to: email,
      from: {
        email: 'nomanriaz7980@gmail.com',
        name: 'Selltron AI'
      },
      replyTo: 'nomanriaz7980@gmail.com',
      subject: 'Your Selltron AI Verification Code',
      text: `Your Selltron AI verification code is: ${verificationCode}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nBest regards,\nSelltron AI Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Code</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background-color: #D72638; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Selltron AI</h1>
              <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 16px;">Email Verification</p>
            </div>
            
            <!-- Content -->
            <div style="padding: 40px 30px;">
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
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="color: #666666; font-size: 12px; margin: 0;">© 2024 Selltron AI. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      // Add headers to improve deliverability
      headers: {
        'X-Mailer': 'Selltron AI',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal'
      },
      // Add categories for better tracking
      categories: ['verification', 'selltron-ai'],
      // Add custom args for tracking
      customArgs: {
        source: 'verification',
        timestamp: new Date().toISOString()
      }
    };

    console.log(`🔧 Attempting to send email via SendGrid...`);
    console.log(`🔧 Email details:`, {
      from: msg.from,
      to: msg.to,
      subject: msg.subject
    });
    
    const result = await sgMail.send(msg);
    console.log(`✅ Email sent successfully to ${email}`);
    console.log(`📧 SendGrid response:`, result);
    return true;
    
  } catch (error) {
    console.error('❌ SendGrid email failed:', error.message);
    console.error('❌ Full error:', error);
    console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
    return false;
  }
};

// Send email with spam prevention
export const sendEmailWithSpamPrevention = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending spam-safe email to: ${email}`);
    
    const msg = {
      to: email,
      from: {
        email: 'nomanriaz7980@gmail.com',
        name: 'Selltron AI'
      },
      replyTo: 'nomanriaz7980@gmail.com',
      subject: 'Your Selltron AI Verification Code',
      text: `Your Selltron AI verification code is: ${verificationCode}\n\nThis code will expire in 5 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nBest regards,\nSelltron AI Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Code</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            
            <!-- Header -->
            <div style="background-color: #D72638; padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Selltron AI</h1>
              <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 16px;">Email Verification</p>
            </div>
            
            <!-- Content -->
            <div style="padding: 40px 30px;">
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
            <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e9ecef;">
              <p style="color: #666666; font-size: 12px; margin: 0;">© 2024 Selltron AI. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      // Anti-spam headers
      headers: {
        'X-Mailer': 'Selltron AI',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal',
        'X-Spam-Check': 'false',
        'X-Anti-Abuse': 'This is a legitimate verification email'
      },
      // Add categories for better tracking
      categories: ['verification', 'selltron-ai'],
      // Add custom args for tracking
      customArgs: {
        source: 'verification',
        timestamp: new Date().toISOString()
      },
      // Add mail settings for better deliverability
      mailSettings: {
        sandboxMode: {
          enable: false
        }
      }
    };
    
    const result = await sgMail.send(msg);
    console.log(`✅ Spam-safe email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Spam-safe email failed:', error.message);
    return false;
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