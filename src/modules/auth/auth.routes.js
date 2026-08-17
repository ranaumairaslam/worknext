const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const {
  createAndSendOtp,
  verifyOtp,
  mapOtpError,
  isMailConfigured,
} = require('./password-reset.service');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

function normalizeEmail(email) {
  if (email == null || email === '') return null;
  return String(email).trim().toLowerCase();
}

function normalizePhone(phone) {
  if (phone == null || phone === '') return null;
  const raw = String(phone).trim();
  if (!raw) return null;
  if (raw.startsWith('+')) {
    return `+${raw.slice(1).replace(/\D/g, '')}`;
  }
  return raw.replace(/\D/g, '');
}

function phonesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.replace(/\D/g, '') === b.replace(/\D/g, '');
}

function getDashboardUrl(role) {
  switch (role) {
    case 'super_admin':
      return '/api/super-admin/dashboard';
    case 'company':
      return '/api/company/dashboard';
    case 'team_leader':
      return '/api/team-leader/dashboard';
    case 'team_member':
      return '/api/team-member/dashboard';
    case 'client':
      return '/api/client/dashboard';
    default:
      return '/';
  }
}

async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

async function findUserByPhone(phone) {
  const digits = phone.replace(/\D/g, '');
  const result = await pool.query(
    `SELECT * FROM users
     WHERE regexp_replace(COALESCE(phone, ''), '[^0-9+]', '', 'g') = $1
        OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
     LIMIT 1`,
    [phone, digits]
  );
  return result.rows[0] || null;
}

function validateNewPasswordPair(newPassword, confirmPassword) {
  if (!newPassword || !confirmPassword) {
    return 'newPassword and confirmPassword are required';
  }
  if (String(newPassword).length < 6) {
    return 'newPassword must be at least 6 characters';
  }
  if (String(newPassword) !== String(confirmPassword)) {
    return 'newPassword and confirmPassword do not match';
  }
  return null;
}

function resolveChannelFromBody(body) {
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);

  if ((!email && !phone) || (email && phone)) {
    return {
      error: 'Provide either email or phone (not both)',
    };
  }

  return {
    email,
    phone,
    channel: email ? 'email' : 'phone',
    destination: email || phone,
  };
}

async function loginHandler(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Email and password are required',
      });
    }

    const user = await findUserByEmail(normalizeEmail(email));
    if (!user) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: 'Invalid email or password',
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        code: 403,
        message: 'Your account is inactive. Please contact support.',
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: 'Invalid email or password',
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    await pool.query(
      'UPDATE users SET token = $1, last_login = NOW() WHERE id = $2',
      [token, user.id]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url || null,
        dashboard: getDashboardUrl(user.role),
      },
    });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

async function changePasswordHandler(req, res) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'currentPassword, newPassword, and confirmPassword are required',
      });
    }

    const passwordError = validateNewPasswordPair(newPassword, confirmPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: passwordError,
      });
    }

    if (String(currentPassword) === String(newPassword)) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'newPassword must be different from currentPassword',
      });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [
      req.user.id,
    ]);
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'User not found',
      });
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        code: 401,
        message: 'currentPassword is incorrect',
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1, token = NULL WHERE id = $2',
      [hashed, user.id]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Password changed successfully. Please log in again.',
      data: {
        userId: user.id,
        email: user.email,
      },
    });
  } catch (error) {
    console.error('CHANGE PASSWORD ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

/**
 * Step 1 — send OTP to registered email
 * POST /api/auth/forgot-password
 * Body: { email } OR { phone }  (phone not supported yet — use email)
 */
async function forgotPasswordHandler(req, res) {
  try {
    const resolved = resolveChannelFromBody(req.body);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: resolved.error,
      });
    }

    const { email, phone, channel, destination } = resolved;
    const user = email
      ? await findUserByEmail(email)
      : await findUserByPhone(phone);

    if (!user || user.status === 'inactive') {
      return res.status(404).json({
        success: false,
        code: 404,
        message:
          channel === 'email'
            ? 'No account found for this email'
            : 'No account found for this phone',
      });
    }

    if (channel === 'phone' && !normalizePhone(user.phone)) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'No phone number is registered for this account',
      });
    }

    const otpResult = await createAndSendOtp({
      userId: user.id,
      channel,
      destination,
      userName: user.name,
    });

    const response = {
      success: true,
      code: 200,
      message: otpResult.sent
        ? 'Password reset OTP sent to your email'
        : 'Password reset OTP generated (development mode — check server console)',
      data: {
        channel,
        email: channel === 'email' ? user.email : null,
        phone: channel === 'phone' ? normalizePhone(user.phone) : null,
        emailConfigured: isMailConfigured(),
        expiresInMinutes: otpResult.expiresInMinutes,
        nextStep:
          'POST /api/auth/reset-password with email, otp, newPassword, confirmPassword',
      },
    };

    if (otpResult.devMode && otpResult.otp) {
      response.data.devOtp = otpResult.otp;
      if (otpResult.mailError) {
        response.data.mailError = otpResult.mailError;
      }
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('FORGOT PASSWORD ERROR:', error);

    if (error.code === 'MAIL_NOT_CONFIGURED') {
      return res.status(503).json({
        success: false,
        code: 503,
        message: error.message,
      });
    }

    if (error.code === 'MAIL_SEND_FAILED') {
      return res.status(503).json({
        success: false,
        code: 503,
        message: error.message,
      });
    }

    if (error.code === 'PHONE_RESET_NOT_SUPPORTED') {
      return res.status(400).json({
        success: false,
        code: 400,
        message: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

/**
 * Step 2 — verify OTP and set new password
 * POST /api/auth/reset-password
 * Body: {
 *   email OR phone,
 *   otp,
 *   newPassword,
 *   confirmPassword
 * }
 */
async function resetPasswordHandler(req, res) {
  try {
    const resolved = resolveChannelFromBody(req.body);
    if (resolved.error) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: resolved.error,
      });
    }

    const { email, phone, channel, destination } = resolved;
    const { otp, newPassword, confirmPassword } = req.body;

    if (!otp || !String(otp).trim()) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'otp is required',
      });
    }

    const passwordError = validateNewPasswordPair(newPassword, confirmPassword);
    if (passwordError) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: passwordError,
      });
    }

    const user = email
      ? await findUserByEmail(email)
      : await findUserByPhone(phone);

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'No account found for this email/phone',
      });
    }

    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        code: 403,
        message: 'Your account is inactive. Please contact support.',
      });
    }

    const otpCheck = await verifyOtp({
      userId: user.id,
      destination,
      otp: String(otp).trim(),
    });

    if (!otpCheck.valid) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: mapOtpError(otpCheck.reason),
      });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password = $1, token = NULL WHERE id = $2',
      [hashed, user.id]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Password reset successfully. You can log in with the new password.',
      data: {
        userId: user.id,
        email: user.email,
        phone: user.phone || null,
        channel,
      },
    });
  } catch (error) {
    console.error('RESET PASSWORD ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

router.route('/login').post(loginHandler).all(methodNotAllowed(['POST']));

router
  .route('/change-password')
  .post(protect, changePasswordHandler)
  .all(methodNotAllowed(['POST']));

router
  .route('/forgot-password')
  .post(forgotPasswordHandler)
  .all(methodNotAllowed(['POST']));

router
  .route('/reset-password')
  .post(resetPasswordHandler)
  .all(methodNotAllowed(['POST']));

module.exports = router;
