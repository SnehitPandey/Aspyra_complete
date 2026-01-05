import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';

export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    // Create transporter with fallback to console logging for development
    if (env.EMAIL_HOST && env.EMAIL_PORT && env.EMAIL_USER && env.EMAIL_PASSWORD) {
      this.transporter = nodemailer.createTransport({
        host: env.EMAIL_HOST,
        port: Number(env.EMAIL_PORT),
        secure: env.EMAIL_PORT === '465', // true for 465, false for other ports
        auth: {
          user: env.EMAIL_USER,
          pass: env.EMAIL_PASSWORD,
        },
        // Enable debug logging in development
        debug: env.NODE_ENV === 'development',
        logger: env.NODE_ENV === 'development',
      });
      
      // Test connection on startup
      this.testConnection();
    } else {
      // Fallback: use console for development/testing
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'unix',
        buffer: true,
      });
      console.warn('⚠️  Email service running in TEST MODE - emails will be logged to console');
      console.warn('⚠️  To enable real emails, set EMAIL_* variables in .env file');
      console.warn('⚠️  For Gmail: Use App Password (not regular password)');
      console.warn('⚠️  Guide: https://support.google.com/accounts/answer/185833');
    }
  }

  /**
   * Test email connection
   */
  async testConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log('✅ Email service connected successfully');
      console.log(`📧 Emails will be sent from: ${env.EMAIL_FROM || env.EMAIL_USER}`);
    } catch (error) {
      console.error('❌ Email service connection failed:', error instanceof Error ? error.message : error);
      console.error('⚠️  Common issues:');
      console.error('   1. Gmail: Use App Password (not regular password)');
      console.error('   2. Enable 2-Factor Authentication on Gmail');
      console.error('   3. Generate App Password: https://myaccount.google.com/apppasswords');
      console.error('   4. Use PORT=587 (not 465) for Gmail');
      console.error('   5. Check EMAIL_USER and EMAIL_PASSWORD in .env');
    }
  }

  /**
   * Generate a 6-digit OTP code
   */
  generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send OTP email
   * @param email - Recipient email address
   * @param code - 6-digit OTP code
   * @param purpose - Purpose of OTP (LOGIN or SIGNUP)
   */
  async sendOTP(email: string, code: string, purpose: 'LOGIN' | 'SIGNUP'): Promise<void> {
    const subject = purpose === 'SIGNUP' 
      ? 'Welcome to Aspyra - Verify Your Email'
      : 'Aspyra - Your Login Code';

    const htmlContent = this.getOTPEmailHTML(code, purpose);
    const textContent = this.getOTPEmailText(code, purpose);

    try {
      const info = await this.transporter.sendMail({
        from: env.EMAIL_FROM || '"Aspyra" <noreply@aspyra.app>',
        to: email,
        subject,
        text: textContent,
        html: htmlContent,
      });

      // Log OTP code in development mode (even with SMTP)
      if (env.NODE_ENV === 'development') {
        console.log('============================================');
        console.log('📧 OTP Email (Development Mode)');
        console.log('============================================');
        console.log('To:', email);
        console.log('Purpose:', purpose);
        console.log('OTP Code:', code);
        console.log('Expires: in 10 minutes');
        console.log('============================================');
      }

      // If using test transporter, log the full email
      if ('buffer' in info) {
        console.log('📧 Email Preview (Console Mode):');
        console.log('Subject:', subject);
        console.log('-------------------');
      } else {
        console.log(`✅ OTP email sent successfully to ${email}:`, info.messageId);
      }
    } catch (error) {
      console.error('❌ Email sending error:', error);
      
      // Provide helpful error messages
      if (error instanceof Error) {
        if (error.message.includes('Invalid login') || error.message.includes('535')) {
          console.error('');
          console.error('🔒 AUTHENTICATION FAILED:');
          console.error('   For Gmail: You must use an App Password, not your regular password');
          console.error('   1. Enable 2-Factor Authentication: https://myaccount.google.com/security');
          console.error('   2. Generate App Password: https://myaccount.google.com/apppasswords');
          console.error('   3. Update EMAIL_PASSWORD in .env with the 16-character code');
          console.error('   4. Restart the server');
          console.error('');
          throw createError('Email authentication failed. Please check EMAIL_PASSWORD in .env (use App Password for Gmail)', 500);
        } else if (error.message.includes('ECONNECTION') || error.message.includes('ETIMEDOUT')) {
          console.error('');
          console.error('🌐 CONNECTION FAILED:');
          console.error('   1. Check your internet connection');
          console.error('   2. Verify EMAIL_HOST and EMAIL_PORT in .env');
          console.error('   3. Try PORT=587 instead of 465 for Gmail');
          console.error('');
          throw createError('Failed to connect to email server', 500);
        }
      }
      
      throw createError('Failed to send OTP email. Please check server logs.', 500);
    }
  }

  /**
   * Get HTML template for OTP email
   */
  private getOTPEmailHTML(code: string, purpose: 'LOGIN' | 'SIGNUP'): string {
    const title = purpose === 'SIGNUP' ? 'Welcome to Aspyra!' : 'Your Login Code';
    const message = purpose === 'SIGNUP'
      ? 'Thank you for signing up! Please use the code below to verify your email address and complete your registration.'
      : 'Use the code below to log in to your Aspyra account.';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${title}</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f4f4f4;
              margin: 0;
              padding: 0;
            }
            .container {
              max-width: 600px;
              margin: 40px auto;
              background: #ffffff;
              border-radius: 10px;
              overflow: hidden;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            }
            .header {
              background: linear-gradient(135deg, #1dd3c1 0%, #0ea5e9 100%);
              padding: 30px;
              text-align: center;
              color: #ffffff;
            }
            .header h1 {
              margin: 0;
              font-size: 28px;
              font-weight: 600;
            }
            .content {
              padding: 40px 30px;
            }
            .otp-box {
              background: #f8fafc;
              border: 2px solid #1dd3c1;
              border-radius: 8px;
              padding: 30px;
              text-align: center;
              margin: 30px 0;
            }
            .otp-code {
              font-size: 36px;
              font-weight: bold;
              color: #1dd3c1;
              letter-spacing: 8px;
              font-family: 'Courier New', monospace;
            }
            .otp-label {
              font-size: 14px;
              color: #64748b;
              margin-top: 10px;
            }
            .warning {
              background: #fef3c7;
              border-left: 4px solid #f59e0b;
              padding: 15px;
              margin: 20px 0;
              border-radius: 4px;
            }
            .warning p {
              margin: 0;
              color: #92400e;
              font-size: 14px;
            }
            .footer {
              background: #f8fafc;
              padding: 20px 30px;
              text-align: center;
              color: #64748b;
              font-size: 12px;
            }
            .footer a {
              color: #1dd3c1;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎯 Aspyra</h1>
            </div>
            <div class="content">
              <h2>${title}</h2>
              <p>${message}</p>
              
              <div class="otp-box">
                <div class="otp-code">${code}</div>
                <div class="otp-label">Your verification code</div>
              </div>
              
              <p>This code will expire in <strong>10 minutes</strong>. If you didn't request this code, please ignore this email.</p>
              
              <div class="warning">
                <p><strong>⚠️ Security Notice:</strong> Never share this code with anyone. Aspyra will never ask you for this code.</p>
              </div>
            </div>
            <div class="footer">
              <p>This email was sent to you because a verification code was requested for your Aspyra account.</p>
              <p>&copy; ${new Date().getFullYear()} Aspyra. All rights reserved.</p>
              <p><a href="https://aspyra.app">Visit our website</a></p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Get plain text version for OTP email
   */
  private getOTPEmailText(code: string, purpose: 'LOGIN' | 'SIGNUP'): string {
    const title = purpose === 'SIGNUP' ? 'Welcome to Aspyra!' : 'Your Login Code';
    const message = purpose === 'SIGNUP'
      ? 'Thank you for signing up! Please use the code below to verify your email address and complete your registration.'
      : 'Use the code below to log in to your Aspyra account.';

    return `
${title}

${message}

Your verification code is: ${code}

This code will expire in 10 minutes.

Security Notice: Never share this code with anyone. Aspyra will never ask you for this code.

If you didn't request this code, please ignore this email.

---
© ${new Date().getFullYear()} Aspyra. All rights reserved.
Visit our website: https://aspyra.app
    `.trim();
  }
}

// Export singleton instance
export const emailService = new EmailService();
