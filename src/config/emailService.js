import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Email Service Configuration
 * Uses Gmail SMTP for email delivery
 * Configured for client's Gmail credentials
 */

// Gmail SMTP with proper configuration for Render
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    console.log(`📧 Sending email to: ${email}`);
    console.log(`🔑 Code: ${verificationCode}`);
    console.log(`🔧 EMAIL_USER: ${process.env.EMAIL_USER || 'skullb960@gmail.com'}`);
    console.log(`🔧 EMAIL_PASSWORD: ${process.env.EMAIL_PASSWORD ? '***SET***' : '***NOT SET***'}`);
    console.log(`🔧 NODE_ENV: ${process.env.NODE_ENV}`);
    
    // Enhanced configuration for both localhost and Render
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 465, // Use secure port for Render
      secure: true, // Use SSL/TLS for Render
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 10000, // 10 seconds
      socketTimeout: 30000 // 30 seconds
    });

    console.log(`🔧 Transporter created successfully`);
    
    // Skip SMTP verification for production (Render) to avoid hanging
    if (process.env.NODE_ENV === 'production') {
      console.log(`🔧 Production environment detected - skipping SMTP verification`);
    } else {
      // Test connection before sending with timeout (only for development)
      console.log(`🔧 Testing SMTP connection...`);
      try {
        await Promise.race([
          transporter.verify(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('SMTP connection timeout')), 10000)
          )
        ]);
        console.log(`✅ SMTP connection verified successfully`);
      } catch (verifyError) {
        console.error(`❌ SMTP connection failed:`, verifyError.message);
        console.log(`🔄 Proceeding anyway - will try to send email...`);
      }
    }

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
    console.log(`🔧 Mail options:`, {
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject
    });
    
    // Send email with timeout
    const result = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Email sending timeout')), 15000)
      )
    ]);
    
    console.log(`✅ Email sent successfully to ${email}`);
    console.log(`📧 Email result:`, result);
    console.log(`📧 Message ID:`, result.messageId);
    console.log(`📧 Response:`, result.response);
    return true;
    
  } catch (error) {
    console.error('❌ Email failed:', error.message);
    console.error('❌ Full error:', error);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error response:', error.response);
    console.log(`🔧 VERIFICATION CODE for ${email}: ${verificationCode}`);
    
    // Additional debugging for Render
    console.log(`🔧 Environment check:`);
    console.log(`🔧 - EMAIL_USER exists: ${!!process.env.EMAIL_USER}`);
    console.log(`🔧 - EMAIL_PASSWORD exists: ${!!process.env.EMAIL_PASSWORD}`);
    console.log(`🔧 - NODE_ENV: ${process.env.NODE_ENV}`);
    
    return false;
  }
};

// Test email service connection
export const testEmailService = async () => {
  try {
    console.log('🧪 Testing Gmail SMTP connection...');
    
    // Create test transporter
    const testTransporter = nodemailer.createTransport({
      service: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    await testTransporter.verify();
    console.log('✅ Gmail SMTP service is ready');
    return true;
  } catch (error) {
    console.error('❌ Gmail SMTP test failed:', error);
    console.error('❌ Test error details:', {
      code: error.code,
      response: error.response,
      message: error.message
    });
    return false;
  }
};

// Alternative email service using different configuration
export const sendVerificationEmailAlternative = async (email, verificationCode) => {
  try {
    console.log(`📧 [ALTERNATIVE] Sending email to: ${email}`);
    
    // Alternative configuration for Render - try different ports
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 30000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });

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
    
    // Send email with timeout
    const result = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Alternative email sending timeout')), 15000)
      )
    ]);
    
    console.log(`✅ [ALTERNATIVE] Email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ [ALTERNATIVE] Email failed:', error.message);
    return false;
  }
};

// Third fallback - Direct SMTP without service
export const sendVerificationEmailDirect = async (email, verificationCode) => {
  try {
    console.log(`📧 [DIRECT] Sending email to: ${email}`);
    
    // Direct SMTP configuration
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 25,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER || 'skullb960@gmail.com',
        pass: process.env.EMAIL_PASSWORD || 'kprjldoulepjaoml'
      },
      ignoreTLS: false,
      requireTLS: true,
      connectionTimeout: 30000,
      greetingTimeout: 10000,
      socketTimeout: 30000
    });

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
    
    const result = await transporter.sendMail(mailOptions);
    console.log(`✅ [DIRECT] Email sent successfully to ${email}`);
    return true;
    
  } catch (error) {
    console.error('❌ [DIRECT] Email failed:', error.message);
    return false;
  }
};