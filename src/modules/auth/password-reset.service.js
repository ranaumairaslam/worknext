const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const { sendMail, isMailConfigured } = require('../../config/mail');

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

async function invalidateActiveOtps(userId) {
  await pool.query(
    `UPDATE password_reset_otps
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId]
  );
}

async function createAndSendOtp({ userId, channel, destination, userName }) {
  if (channel === 'phone') {
    const err = new Error(
      'Phone password reset is not enabled. Please use your registered email.'
    );
    err.code = 'PHONE_RESET_NOT_SUPPORTED';
    throw err;
  }

  await invalidateActiveOtps(userId);

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  await pool.query(
    `INSERT INTO password_reset_otps (
      user_id, channel, destination, otp_hash, expires_at
    )
    VALUES ($1, $2, $3, $4, $5)`,
    [userId, channel, destination, otpHash, expiresAt]
  );

  if (!isMailConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[password-reset] OTP for ${destination}: ${otp}`);
      return {
        sent: false,
        devMode: true,
        expiresInMinutes: OTP_TTL_MINUTES,
        otp,
      };
    }

    const err = new Error(
      'Email service is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env'
    );
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }

  const greeting = userName ? `Hi ${userName},` : 'Hi,';
  const mailPayload = {
    to: destination,
    subject: 'WorkNest password reset code',
    text: `${greeting}\n\nYour password reset code is ${otp}.\nIt expires in ${OTP_TTL_MINUTES} minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <p>${greeting}</p>
      <p>Your password reset code is:</p>
      <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${otp}</p>
      <p>This code expires in ${OTP_TTL_MINUTES} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  };

  try {
    await sendMail(mailPayload);
    return {
      sent: true,
      expiresInMinutes: OTP_TTL_MINUTES,
    };
  } catch (error) {
    console.error('[password-reset] Email send failed:', error.message);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[password-reset] OTP for ${destination}: ${otp}`);
      return {
        sent: false,
        devMode: true,
        mailError: error.message,
        expiresInMinutes: OTP_TTL_MINUTES,
        otp,
      };
    }

    const err = new Error(
      'Unable to send password reset email. Please verify SMTP settings or try again later.'
    );
    err.code = 'MAIL_SEND_FAILED';
    err.cause = error;
    throw err;
  }
}

async function verifyOtp({ userId, destination, otp }) {
  const { rows } = await pool.query(
    `SELECT id, otp_hash, expires_at, attempts, used_at
     FROM password_reset_otps
     WHERE user_id = $1
       AND LOWER(destination) = LOWER($2)
       AND used_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, destination]
  );

  const record = rows[0];
  if (!record) {
    return { valid: false, reason: 'no_otp' };
  }

  if (new Date(record.expires_at) < new Date()) {
    return { valid: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { valid: false, reason: 'max_attempts' };
  }

  const match = await bcrypt.compare(String(otp).trim(), record.otp_hash);
  if (!match) {
    await pool.query(
      `UPDATE password_reset_otps SET attempts = attempts + 1 WHERE id = $1`,
      [record.id]
    );
    return { valid: false, reason: 'invalid' };
  }

  await pool.query(
    `UPDATE password_reset_otps SET used_at = NOW() WHERE id = $1`,
    [record.id]
  );

  return { valid: true };
}

function mapOtpError(reason) {
  switch (reason) {
    case 'expired':
      return 'OTP has expired. Request a new code.';
    case 'max_attempts':
      return 'Too many invalid attempts. Request a new code.';
    case 'invalid':
      return 'Invalid OTP';
    case 'no_otp':
      return 'No active OTP found. Request a new code from forgot-password.';
    default:
      return 'OTP verification failed';
  }
}

module.exports = {
  OTP_TTL_MINUTES,
  createAndSendOtp,
  verifyOtp,
  mapOtpError,
  isMailConfigured,
};
