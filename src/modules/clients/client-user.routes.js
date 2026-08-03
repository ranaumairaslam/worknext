const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

// GET /api/client-dashboard/dashboard (will be mapped to /api/client/dashboard)
router.get('/dashboard', protect, authorize('client'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT cl.id, cl.name, cl.email, cl.created_at, c.id AS company_id, c.name AS company_name
      FROM clients cl
      JOIN companies c ON c.id = cl.company_id
      WHERE cl.user_id = $1
    `, [req.user.id]);
    
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }
    
    res.json({ success: true, dashboard: 'client', data: rows[0] });
  } catch (error) { 
    next(error); 
  }
});

module.exports = router;
