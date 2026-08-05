const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const taskRoutes = require('../team-member/tasks');
const meetingRoutes = require('../team-member/meetings');

const router = express.Router();

const getDashboardData = async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, t.id AS team_id, t.name AS team_name, c.id AS company_id, c.name AS company_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN companies c ON c.id = COALESCE(u.company_id, t.company_id)
      WHERE u.id = $1
    `, [req.user.id]);
    res.json({ success: true, dashboard: 'team_member', data: rows[0] || null });
  } catch (error) { 
    next(error); 
  }
};

// GET /api/team-member/ and GET /api/team-member/dashboard
router.get('/', protect, authorize('team_member'), getDashboardData);
router.get('/dashboard', protect, authorize('team_member'), getDashboardData);

router.use('/tasks', taskRoutes);
router.use('/meetings', meetingRoutes);

module.exports = router;
