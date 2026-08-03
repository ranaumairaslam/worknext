const express = require('express');
const pool = require('../../config/db');

const router = express.Router();

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

// GET /api/company/teams - List teams
router.get('/', async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    const where = ['company_id = $1'];
    const values = [req.company.id];
    if (search) {
      values.push(`%${search}%`);
      where.push(`name ILIKE $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const teams = await pool.query(
      `SELECT t.id, t.name, t.leader_id, u.name AS leader_name, t.created_at
       FROM teams t
       LEFT JOIN users u ON u.id = t.leader_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM teams ${whereClause}`, values);

    res.json({ success: true, data: teams.rows, pagination: { page, limit, total: count.rows[0].total } });
  } catch (error) {
    next(error);
  }
});

// POST /api/company/teams - Create team
router.post('/', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const { name, leaderId } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: teamRows } = await client.query(
        'INSERT INTO teams (name, company_id, leader_id) VALUES ($1, $2, $3) RETURNING id, name, leader_id, created_at',
        [name.trim(), req.company.id, leaderId || null]
      );

      if (leaderId) {
        const userResult = await client.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [leaderId, req.company.id]);
        if (!userResult.rows[0]) {
          await client.query('ROLLBACK');
          return res.status(404).json({ success: false, message: 'Team leader not found in this company' });
        }
        await client.query('UPDATE users SET role = $1, team_id = $2 WHERE id = $3', ['team_leader', teamRows[0].id, leaderId]);
      }

      await client.query('COMMIT');
      res.status(201).json({ success: true, message: 'Team created', data: teamRows[0] });
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

// GET /api/company/teams/:teamId - Get team details
router.get('/:teamId', async (req, res, next) => {
  try {
    const teamId = positiveInteger(req.params.teamId, 0, 1000000000);
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Invalid team id' });
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.leader_id, u.name AS leader_name, t.created_at
       FROM teams t
       LEFT JOIN users u ON u.id = t.leader_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [teamId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/teams/:teamId - Update team
router.put('/:teamId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const teamId = positiveInteger(req.params.teamId, 0, 1000000000);
    const { name, leaderId } = req.body;
    if (!teamId) {
      return res.status(400).json({ success: false, message: 'Invalid team id' });
    }

    if (leaderId) {
      const leaderResult = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [leaderId, req.company.id]);
      if (!leaderResult.rows[0]) {
        return res.status(404).json({ success: false, message: 'Leader not found in this company' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE teams SET
         name = COALESCE(NULLIF($1, ''), name),
         leader_id = COALESCE($2, leader_id)
       WHERE id = $3 AND company_id = $4
       RETURNING id, name, leader_id, created_at`,
      [name, leaderId || null, teamId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    if (leaderId) {
      await pool.query('UPDATE users SET role = $1, team_id = $2 WHERE id = $3', ['team_leader', teamId, leaderId]);
    }

    res.json({ success: true, message: 'Team updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// POST /api/company/teams/:teamId/members - Add member to team
router.post('/:teamId/members', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const teamId = positiveInteger(req.params.teamId, 0, 1000000000);
    const { memberId } = req.body;
    const memberIdInt = positiveInteger(memberId, 0, 1000000000);

    if (!teamId || !memberIdInt) {
      return res.status(400).json({ success: false, message: 'Invalid team id or member id' });
    }

    const teamResult = await pool.query('SELECT id FROM teams WHERE id = $1 AND company_id = $2', [teamId, req.company.id]);
    if (!teamResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const userResult = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [memberIdInt, req.company.id]);
    if (!userResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Employee not found in this company' });
    }

    await pool.query('UPDATE users SET team_id = $1 WHERE id = $2', [teamId, memberIdInt]);
    res.json({ success: true, message: 'Member added to team' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/company/teams/:teamId/members/:memberId - Remove member from team
router.delete('/:teamId/members/:memberId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const teamId = positiveInteger(req.params.teamId, 0, 1000000000);
    const memberId = positiveInteger(req.params.memberId, 0, 1000000000);
    if (!teamId || !memberId) {
      return res.status(400).json({ success: false, message: 'Invalid team id or member id' });
    }

    const teamResult = await pool.query('SELECT id FROM teams WHERE id = $1 AND company_id = $2', [teamId, req.company.id]);
    if (!teamResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Team not found' });
    }

    const { rowCount } = await pool.query('UPDATE users SET team_id = NULL WHERE id = $1 AND company_id = $2 AND team_id = $3', [memberId, req.company.id, teamId]);
    if (!rowCount) {
      return res.status(404).json({ success: false, message: 'Member not found in this team' });
    }

    res.json({ success: true, message: 'Member removed from team' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
