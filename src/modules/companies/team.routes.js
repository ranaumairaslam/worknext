const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

// Load company context (same pattern as company.routes.js, kept local
// so this router also works if mounted independently)
async function loadCompany(req, res, next) {
  if (req.company) return next(); // already loaded by parent router
  try {
    const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [req.user.id]);
    const companyId = userResult.rows[0]?.company_id || req.user.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, message: 'User does not belong to a company' });
    }
    req.company = { id: companyId };
    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCompany);

// =======================================================
// WORKFLOW STEP 2: CREATE TEAM
// =======================================================

// POST /api/company/teams - Create a new team
router.post('/', authorizeRole('company', 'super_admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO teams (company_id, name, description, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, company_id, name, description, leader_id, created_at`,
      [req.company.id, name.trim(), description?.trim() || null]
    );

    res.status(201).json({ success: true, message: 'Team created successfully', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/teams - List all teams
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email,
              COUNT(members.id)::int AS member_count
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       LEFT JOIN users members ON members.team_id = t.id
       WHERE t.company_id = $1
       GROUP BY t.id, leader.id, leader.name, leader.email
       ORDER BY t.created_at DESC`,
      [req.company.id]
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/teams/:teamId - Get single team with members
router.get('/:teamId', async (req, res, next) => {
  try {
    const team = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [req.params.teamId, req.company.id]
    );

    if (!team.rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const members = await pool.query(
      `SELECT id, name, email, role, status FROM users WHERE team_id = $1`,
      [req.params.teamId]
    );

    res.json({ success: true, data: { ...team.rows[0], members: members.rows } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/teams/:teamId - Update team details
router.put('/:teamId', authorizeRole('company', 'super_admin'), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const { rows } = await pool.query(
      `UPDATE teams SET
         name = COALESCE(NULLIF($1, ''), name),
         description = COALESCE(NULLIF($2, ''), description),
         updated_at = NOW()
       WHERE id = $3 AND company_id = $4
       RETURNING id, company_id, name, description, leader_id, updated_at`,
      [name, description, req.params.teamId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, message: 'Team updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// =======================================================
// WORKFLOW STEP 3: ASSIGN TEAM LEADER
// =======================================================

// PUT /api/company/teams/:teamId/assign-leader - Assign a team leader
router.put('/:teamId/assign-leader', authorizeRole('company', 'super_admin'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required to assign a team leader' });
    }

    await client.query('BEGIN');

    // Verify team belongs to this company
    const team = await client.query(
      'SELECT id FROM teams WHERE id = $1 AND company_id = $2',
      [req.params.teamId, req.company.id]
    );
    if (!team.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    // Verify the user belongs to this company
    const user = await client.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND company_id = $2',
      [userId, req.company.id]
    );
    if (!user.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Employee not found in this company' });
    }

    // Assign as leader on the team
    const updatedTeam = await client.query(
      `UPDATE teams SET leader_id = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, leader_id`,
      [userId, req.params.teamId]
    );

    // Promote user's role to team_leader and attach them to the team
    await client.query(
      `UPDATE users SET role = 'team_leader', team_id = $1 WHERE id = $2`,
      [req.params.teamId, userId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `${user.rows[0].name} assigned as team leader`,
      data: updatedTeam.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// POST /api/company/teams/:teamId/members - Add a member to a team
router.post('/:teamId/members', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET team_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, name, email, role, team_id`,
      [req.params.teamId, userId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Employee not found in this company' });
    }

    res.json({ success: true, message: 'Member added to team', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/company/teams/:teamId - Delete a team
router.delete('/:teamId', authorizeRole('company', 'super_admin'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM teams WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.teamId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, message: 'Team deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;