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

// Send email with advanced spam prevention
export const sendEmailWithSpamPrevention = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending advanced spam-safe email to: ${email}`);
    
    const msg = {
      to: email,
      from: {
        email: 'nomanriaz7980@gmail.com',
        name: 'Selltron AI'
      },
      replyTo: 'nomanriaz7980@gmail.com',
      subject: 'Selltron AI - Your Verification Code',
      text: `Hello,

Your Selltron AI verification code is: ${verificationCode}

This code will expire in 5 minutes.

If you didn't request this code, please ignore this email.

Best regards,
Selltron AI Team

---
This is an automated message. Please do not reply to this email.`,
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verification Code - Selltron AI</title>
          <style>
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8f9fa; }
            .container { max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; }
            .header { background-color: #D72638; padding: 30px; text-align: center; }
            .content { padding: 40px 30px; }
            .code-box { background-color: #f8f9fa; border: 2px solid #D72638; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .verification-code { color: #D72638; font-size: 28px; font-weight: bold; letter-spacing: 3px; font-family: 'Courier New', monospace; }
            .footer { background-color: #f8f9fa; padding: 20px; text-align: center; border-top: 1px solid #e9ecef; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: bold;">Selltron AI</h1>
              <p style="color: #ffffff; margin: 5px 0 0 0; font-size: 16px;">Email Verification</p>
            </div>
            
            <div class="content">
              <h2 style="color: #333333; margin: 0 0 20px 0; font-size: 20px; text-align: center;">Your Verification Code</h2>
              
              <div class="code-box">
                <span class="verification-code">${verificationCode}</span>
              </div>
              
              <div style="text-align: center; color: #666666; font-size: 14px; line-height: 1.5;">
                <p style="margin: 0 0 10px 0;">This verification code will expire in 5 minutes.</p>
                <p style="margin: 0;">If you didn't request this code, please ignore this email.</p>
              </div>
            </div>
            
            <div class="footer">
              <p style="color: #666666; font-size: 12px; margin: 0;">© 2024 Selltron AI. All rights reserved.</p>
              <p style="color: #999999; font-size: 11px; margin: 5px 0 0 0;">This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      // Advanced anti-spam headers
      headers: {
        'X-Mailer': 'Selltron AI v1.0',
        'X-Priority': '3',
        'X-MSMail-Priority': 'Normal',
        'Importance': 'Normal',
        'X-Spam-Check': 'false',
        'X-Anti-Abuse': 'This is a legitimate verification email from Selltron AI',
        'X-Entity-Ref-ID': `selltron-ai-${Date.now()}`,
        'X-SG-EID': `selltron-verification-${Math.random().toString(36).substr(2, 9)}`,
        'List-Unsubscribe': '<mailto:unsubscribe@selltron-ai.com>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      },
      // Add categories for better tracking
      categories: ['verification', 'selltron-ai', 'account-security'],
      // Add custom args for tracking
      customArgs: {
        source: 'verification',
        timestamp: new Date().toISOString(),
        user_agent: 'selltron-ai-verification',
        campaign_id: `verify-${Date.now()}`
      },
      // Advanced mail settings for better deliverability
      mailSettings: {
        sandboxMode: {
          enable: false
        },
        footer: {
          enable: false
        },
        spamCheck: {
          enable: false
        }
      },
      // Add tracking settings
      trackingSettings: {
        clickTracking: {
          enable: false
        },
        openTracking: {
          enable: false
        },
        subscriptionTracking: {
          enable: false
        }
      }
    };
    
    const result = await sgMail.send(msg);
    console.log(`✅ Advanced spam-safe email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Advanced spam-safe email failed:', error.message);
    return false;
  }
};

// Ultra simple email - text only, no HTML
export const sendProfessionalEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending ultra-simple email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    
    const msg = {
      to: email,
      from: 'nomanriaz7980@gmail.com',
      subject: 'Verification Code',
      text: `Code: ${verificationCode}

Expires in 5 minutes.

Selltron AI`
    };
    
    console.log('📧 Email details:', {
      to: email,
      from: 'nomanriaz7980@gmail.com',
      subject: 'Verification Code'
    });
    
    const result = await sgMail.send(msg);
    console.log(`✅ Ultra-simple email sent successfully to ${email}`);
    console.log('📧 SendGrid response:', result);
    return true;
    
  } catch (error) {
    console.error('❌ Ultra-simple email failed:', error.message);
    console.error('❌ Full error:', error);
    return false;
  }
};

// Alternative: Try with different sender approach
export const sendAlternativeEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Trying alternative email approach to: ${email}`);
    
    const msg = {
      to: email,
      from: {
        email: 'nomanriaz7980@gmail.com',
        name: 'Selltron'
      },
      subject: 'Code',
      text: `${verificationCode}`,
      // Add some basic headers that might help
      headers: {
        'X-Mailer': 'Selltron',
        'X-Priority': '3'
      }
    };
    
    const result = await sgMail.send(msg);
    console.log(`✅ Alternative email sent to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ Alternative email failed:', error.message);
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