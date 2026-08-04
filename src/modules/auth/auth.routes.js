const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');

const router = express.Router();

// Helper to determine dashboard endpoint based on user role
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

// Unified Login Endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email and password are required' 
      });
    }

    const sanitizedEmail = String(email).trim().toLowerCase();

    // Query user by email
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [sanitizedEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    const user = result.rows[0];

    // Check status
    if (user.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Your account is inactive. Please contact support.'
      });
    }

    // Compare passwords
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    // Save token and update last login time
    await pool.query(
      'UPDATE users SET token = $1, last_login = NOW() WHERE id = $2',
      [token, user.id]
    );

    // Determine dashboard redirect URL
    const dashboardUrl = getDashboardUrl(user.role);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        dashboard: dashboardUrl
      }
    });

  } catch (error) {
    console.error('LOGIN ERROR:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error' 
    });
  }
});

module.exports = router;
