const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

// GET /api/team-leader/dashboard
router.get('/dashboard', protect, authorize('team_leader'), async (req, res, next) => {
  try {
    const { rows: teams } = await pool.query(
      'SELECT id, name, company_id, created_at FROM teams WHERE leader_id = $1 ORDER BY created_at DESC', 
      [req.user.id]
    );
    const teamIds = teams.map((team) => team.id);
    
    let totalMembers = 0;
    if (teamIds.length > 0) {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS total_members FROM users WHERE team_id = ANY($1::int[])', 
        [teamIds]
      );
      totalMembers = rows[0].total_members;
    }
    
    res.json({ 
      success: true, 
      dashboard: 'team_leader', 
      data: { 
        teams, 
        total_teams: teams.length, 
        total_members: totalMembers 
      } 
    });
  } catch (error) { 
    next(error); 
  }
});

module.exports = router;
