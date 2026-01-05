#!/usr/bin/env node

/**
 * Email Configuration Test Script
 * Run: node test-email.js
 * 
 * This script tests your email configuration without starting the full server.
 */

const nodemailer = require('nodemailer');
const { config } = require('dotenv');

// Load environment variables
config();

const EMAIL_HOST = process.env.EMAIL_HOST;
const EMAIL_PORT = process.env.EMAIL_PORT;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || `"Test" <${EMAIL_USER}>`;

console.log('\n🔧 Email Configuration Test\n');
console.log('================================');
console.log('Host:', EMAIL_HOST || '❌ Not set');
console.log('Port:', EMAIL_PORT || '❌ Not set');
console.log('User:', EMAIL_USER || '❌ Not set');
console.log('Password:', EMAIL_PASSWORD ? '✅ Set (hidden)' : '❌ Not set');
console.log('From:', EMAIL_FROM);
console.log('================================\n');

if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASSWORD) {
  console.error('❌ Missing required email configuration in .env file\n');
  console.log('Please set these variables in backend/.env:');
  console.log('  EMAIL_HOST=smtp.gmail.com');
  console.log('  EMAIL_PORT=587');
  console.log('  EMAIL_USER=your-email@gmail.com');
  console.log('  EMAIL_PASSWORD=your-app-password-here');
  console.log('\nFor Gmail: Use App Password, not regular password');
  console.log('Guide: https://support.google.com/accounts/answer/185833\n');
  process.exit(1);
}

// Create transporter
const transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: Number(EMAIL_PORT),
  secure: EMAIL_PORT === '465',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASSWORD,
  },
  debug: true,
  logger: true,
});

async function testConnection() {
  console.log('🔍 Testing connection to email server...\n');
  
  try {
    await transporter.verify();
    console.log('\n✅ SUCCESS! Email server connection verified.\n');
    return true;
  } catch (error) {
    console.error('\n❌ FAILED! Could not connect to email server.\n');
    console.error('Error:', error.message);
    
    // Provide specific help based on error
    if (error.message.includes('Invalid login') || error.message.includes('534')) {
      console.error('\n🔒 AUTHENTICATION FAILED:');
      console.error('For Gmail, you MUST use an App Password:\n');
      console.error('1. Enable 2-Factor Authentication');
      console.error('   → https://myaccount.google.com/security');
      console.error('2. Generate App Password');
      console.error('   → https://myaccount.google.com/apppasswords');
      console.error('3. Update EMAIL_PASSWORD in .env with 16-char code');
      console.error('4. Restart this script\n');
    } else if (error.message.includes('ECONNECTION') || error.message.includes('ETIMEDOUT')) {
      console.error('\n🌐 CONNECTION FAILED:');
      console.error('1. Check your internet connection');
      console.error('2. Verify EMAIL_HOST and EMAIL_PORT');
      console.error('3. For Gmail, try PORT=587 (not 465)\n');
    }
    
    return false;
  }
}

async function sendTestEmail() {
  const testEmail = process.argv[2] || EMAIL_USER;
  
  console.log(`📧 Sending test email to: ${testEmail}\n`);
  
  const testOTP = '123456';
  
  try {
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to: testEmail,
      subject: '🧪 Aspyra Email Test',
      text: `This is a test email from Aspyra.\n\nTest OTP: ${testOTP}\n\nIf you received this, your email configuration is working! 🎉`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1dd3c1 0%, #14b8a6 100%); color: white; padding: 20px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }
            .otp-box { background: white; border: 2px solid #1dd3c1; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
            .otp-code { font-size: 32px; font-weight: bold; color: #1dd3c1; letter-spacing: 8px; }
            .success { color: #10b981; font-size: 18px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🧪 Email Test</h1>
            </div>
            <div class="content">
              <h2 class="success">✅ Success!</h2>
              <p>This is a test email from <strong>Aspyra</strong>.</p>
              <div class="otp-box">
                <p style="margin: 0; color: #666;">Test OTP Code:</p>
                <div class="otp-code">${testOTP}</div>
              </div>
              <p>If you received this email, your email configuration is working correctly! 🎉</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
              <p style="font-size: 12px; color: #666;">
                This is an automated test email. If you did not request this, you can safely ignore it.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    
    console.log('\n✅ SUCCESS! Test email sent successfully.');
    console.log('Message ID:', info.messageId);
    console.log('\nCheck your inbox (and spam folder) for the test email.\n');
    return true;
  } catch (error) {
    console.error('\n❌ FAILED! Could not send test email.');
    console.error('Error:', error.message, '\n');
    return false;
  }
}

async function main() {
  const connectionOk = await testConnection();
  
  if (!connectionOk) {
    process.exit(1);
  }
  
  console.log('Would you like to send a test email? (Ctrl+C to cancel)');
  console.log('Press Enter to send to', EMAIL_USER);
  console.log('Or provide an email: node test-email.js your@email.com\n');
  
  // Wait 2 seconds before sending
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const emailSent = await sendTestEmail();
  
  if (emailSent) {
    console.log('🎉 All tests passed! Your email configuration is ready.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Email test failed. Please check the errors above.\n');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
