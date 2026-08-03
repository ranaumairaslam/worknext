const express = require('express');
const pool = require('../../config/db');

const router = express.Router();

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const validateEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim());

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

// GET /api/company/employees - List employees
router.get('/', async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const role = ['team_leader', 'team_member'].includes(req.query.role) ? req.query.role : null;
    const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : null;

    const where = ['company_id = $1', `role IN ('team_leader', 'team_member', 'company')`];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length})`);
    }
    if (role) {
      values.push(role);
      where.push(`role = $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const employees = await pool.query(
      `SELECT id, name, email, role, status, team_id, created_at FROM users ${whereClause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM users ${whereClause}`, values);

    res.json({ success: true, data: employees.rows, pagination: { page, limit, total: count.rows[0].total } });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/employees/:employeeId - Get single employee details
router.get('/:employeeId', async (req, res, next) => {
  try {
    const employeeId = positiveInteger(req.params.employeeId, 0, 1000000000);
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Invalid employee id' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, email, role, status, team_id, created_at
       FROM users
       WHERE id = $1 AND company_id = $2 AND role IN ('team_leader', 'team_member', 'company')`,
      [employeeId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/employees/:employeeId - Update employee profile
router.put('/:employeeId', authorizeRole('company'), async (req, res, next) => {
  try {
    const employeeId = positiveInteger(req.params.employeeId, 0, 1000000000);
    const { name, email, role, status, teamId } = req.body;
    if (!employeeId) {
      return res.status(400).json({ success: false, message: 'Invalid employee id' });
    }
    if (email && !validateEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }
    if (role && !['team_leader', 'team_member'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be team_leader or team_member' });
    }
    if (status && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    const { rows } = await pool.query(
      `UPDATE users SET
         name = COALESCE(NULLIF($1, ''), name),
         email = COALESCE(NULLIF($2, ''), email),
         role = COALESCE(NULLIF($3, ''), role),
         status = COALESCE(NULLIF($4, ''), status),
         team_id = COALESCE($5, team_id)
       WHERE id = $6 AND company_id = $7 AND role IN ('team_leader', 'team_member', 'company')
       RETURNING id, name, email, role, status, team_id, created_at`,
      [name, email && email.trim().toLowerCase(), role, status, teamId || null, employeeId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    res.json({ success: true, message: 'Employee updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
