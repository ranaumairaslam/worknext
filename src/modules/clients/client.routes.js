const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');

const router = express.Router();

const validateEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim());

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

// GET /api/company/clients - List clients
router.get('/', async (req, res, next) => {
  try {
    const clients = await pool.query(
      `SELECT cl.id, cl.name, cl.email, cl.created_at, u.id AS user_id
       FROM clients cl
       LEFT JOIN users u ON u.id = cl.user_id
       WHERE cl.company_id = $1
       ORDER BY cl.created_at DESC`,
      [req.company.id]
    );

    res.json({ success: true, data: clients.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/company/clients - Create client profile
router.post('/', authorizeRole('company'), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
    }
    if (!validateEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (existing.rows[0]) {
      return res.status(409).json({ success: false, message: 'A user with that email already exists' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passwordHash = await bcrypt.hash(password, 10);
      const { rows: userRows } = await client.query(
        'INSERT INTO users (name, email, password, role, company_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, company_id',
        [name.trim(), email.trim().toLowerCase(), passwordHash, 'client', req.company.id]
      );
      const { rows: clientRows } = await client.query(
        'INSERT INTO clients (name, email, company_id, user_id) VALUES ($1, $2, $3, $4) RETURNING id, name, email, company_id, user_id, created_at',
        [name.trim(), email.trim().toLowerCase(), req.company.id, userRows[0].id]
      );
      await client.query('COMMIT');

      res.status(201).json({ success: true, message: 'Client created', data: clientRows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
