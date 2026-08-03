const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router();

const allowedProjectStatuses = ['active', 'inactive', 'completed'];
const allowedTaskStatuses = ['todo', 'in_progress', 'done', 'blocked'];
const allowedTaskPriorities = ['low', 'medium', 'high'];
const allowedUserRoles = ['company', 'team_leader', 'team_member', 'client'];

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const validateEmail = (value) => /^\\S+@\\S+\\.\\S+$/.test(String(value || '').trim());

const getSearchClause = (search, prefix = 'name') => {
  if (!search) return { clause: '', values: [] };
  const value = `%${search.trim()}%`;
  return { clause: `AND ${prefix} ILIKE $1`, values: [value] };
};

async function loadCompany(req, res, next) {
  try {
    const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [req.user.id]);
    const companyId = userResult.rows[0]?.company_id || req.user.companyId;

    if (!companyId) {
      return res.status(403).json({ success: false, message: 'User does not belong to a company' });
    }

    const companyResult = await pool.query('SELECT id, name, status, email, phone, address, industry, website FROM companies WHERE id = $1', [companyId]);
    if (!companyResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    req.company = companyResult.rows[0];
    next();
  } catch (error) {
    next(error);
  }
}

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

router.use(protect, loadCompany);

router.get('/dashboard', async (req, res, next) => {
  try {
    const companyId = req.company.id;

    const [projectSummary, teamSummary, clientSummary, employeeSummary, taskSummary, revenueSummary, projectProgress] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_projects,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_projects,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_projects
        FROM projects
        WHERE company_id = $1
      `, [companyId]),
      pool.query('SELECT COUNT(*)::int AS total_teams FROM teams WHERE company_id = $1', [companyId]),
      pool.query('SELECT COUNT(*)::int AS total_clients FROM clients WHERE company_id = $1', [companyId]),
      pool.query(`
        SELECT
          COUNT(*)::int AS total_employees,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_employees,
          COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_employees
        FROM users
        WHERE company_id = $1 AND role IN ('company', 'team_leader', 'team_member')
      `, [companyId]),
      pool.query(`
        SELECT
          COUNT(*)::int AS total_tasks,
          COUNT(*) FILTER (WHERE status IN ('todo', 'in_progress'))::int AS active_tasks,
          COUNT(*) FILTER (WHERE status = 'done')::int AS completed_tasks,
          COUNT(*) FILTER (WHERE status = 'blocked')::int AS pending_tasks
        FROM tasks
        WHERE company_id = $1
      `, [companyId]),
      pool.query('SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS total_revenue FROM revenues WHERE company_id = $1', [companyId]),
      pool.query(`
        SELECT
          p.id AS project_id,
          p.name AS project_name,
          COALESCE(team.name, 'Unassigned') AS assigned_team,
          p.status,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) / NULLIF(COUNT(t.id), 0)), 0)::int AS progress
        FROM projects p
        LEFT JOIN tasks t ON t.project_id = p.id
        LEFT JOIN LATERAL (
          SELECT tm.id, tm.name
          FROM tasks tt
          JOIN users u ON u.id = tt.assignee_id
          JOIN teams tm ON tm.id = u.team_id
          WHERE tt.project_id = p.id AND tm.id IS NOT NULL
          GROUP BY tm.id, tm.name
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) team ON true
        WHERE p.company_id = $1
        GROUP BY p.id, p.name, p.status, team.name
        ORDER BY p.created_at DESC
        LIMIT 6
      `, [companyId]),
    ]);

    res.json({
      success: true,
      data: {
        company: req.company,
        total_projects: projectSummary.rows[0].total_projects,
        active_projects: projectSummary.rows[0].active_projects,
        completed_projects: projectSummary.rows[0].completed_projects,
        total_teams: teamSummary.rows[0].total_teams,
        total_employees: employeeSummary.rows[0].total_employees,
        total_clients: clientSummary.rows[0].total_clients,
        total_revenue: Number(revenueSummary.rows[0].total_revenue),
        active_tasks: taskSummary.rows[0].active_tasks,
        completed_tasks: taskSummary.rows[0].completed_tasks,
        pending_tasks: taskSummary.rows[0].pending_tasks,
        project_progress: projectProgress.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/profile', async (req, res, next) => {
  try {
    const company = await pool.query(
      `SELECT c.id, c.name, c.email, c.phone, c.address, c.industry, c.website, c.status, c.created_at, c.updated_at,
              u.id AS owner_id, u.name AS owner_name, u.email AS owner_email
       FROM companies c
       LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.id = $1`,
      [req.company.id]
    );

    if (!company.rows[0]) {
      return res.status(404).json({ success: false, message: 'Company profile not found' });
    }

    res.json({ success: true, data: company.rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/profile', authorizeRole('company'), async (req, res, next) => {
  try {
    const { name, email, phone, address, industry, website } = req.body;
    if (email && !validateEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    const { rows } = await pool.query(
      `UPDATE companies SET
         name = COALESCE(NULLIF($1, ''), name),
         email = COALESCE(NULLIF($2, ''), email),
         phone = COALESCE(NULLIF($3, ''), phone),
         address = COALESCE(NULLIF($4, ''), address),
         industry = COALESCE(NULLIF($5, ''), industry),
         website = COALESCE(NULLIF($6, ''), website),
         updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, email, phone, address, industry, website, status, created_at, updated_at`,
      [name, email && email.trim().toLowerCase(), phone, address, industry, website, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Company not found' });
    }

    res.json({ success: true, message: 'Company profile updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// Projects
router.get('/projects', async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = allowedProjectStatuses.includes(req.query.status) ? req.query.status : null;

    const where = ['company_id = $1'];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`name ILIKE $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const projects = await pool.query(
      `SELECT id, name, status, created_at FROM projects ${whereClause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM projects ${whereClause}`, values);

    res.json({ success: true, data: projects.rows, pagination: { page, limit, total: count.rows[0].total } });
  } catch (error) {
    next(error);
  }
});

router.post('/projects', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const { name, status = 'active' } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }
    if (status && !allowedProjectStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid project status' });
    }

    const { rows } = await pool.query(
      'INSERT INTO projects (name, company_id, status) VALUES ($1, $2, $3) RETURNING id, name, status, created_at',
      [name.trim(), req.company.id, status]
    );

    res.status(201).json({ success: true, message: 'Project created', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/projects/:projectId', async (req, res, next) => {
  try {
    const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Invalid project id' });
    }

    const { rows } = await pool.query('SELECT id, name, status, created_at FROM projects WHERE id = $1 AND company_id = $2', [projectId, req.company.id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/projects/:projectId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Invalid project id' });
    }

    const { name, status } = req.body;
    if (status && !allowedProjectStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid project status' });
    }

    const { rows } = await pool.query(
      `UPDATE projects SET
         name = COALESCE(NULLIF($1, ''), name),
         status = COALESCE(NULLIF($2, ''), status)
       WHERE id = $3 AND company_id = $4
       RETURNING id, name, status, created_at`,
      [name, status, projectId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, message: 'Project updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.patch('/projects/:projectId/status', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
    const { status } = req.body;
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Invalid project id' });
    }
    if (!allowedProjectStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be active, inactive, or completed' });
    }

    const { rows } = await pool.query('UPDATE projects SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING id, name, status, created_at', [status, projectId, req.company.id]);
    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, message: 'Project status updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// Teams
router.get('/teams', async (req, res, next) => {
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

router.post('/teams', authorizeRole('company', 'team_leader'), async (req, res, next) => {
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

router.get('/teams/:teamId', async (req, res, next) => {
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

router.put('/teams/:teamId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
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

router.post('/teams/:teamId/members', authorizeRole('company', 'team_leader'), async (req, res, next) => {
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

router.delete('/teams/:teamId/members/:memberId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
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

// Employees
router.get('/employees', async (req, res, next) => {
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

router.get('/employees/:employeeId', async (req, res, next) => {
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

router.put('/employees/:employeeId', authorizeRole('company'), async (req, res, next) => {
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

// Clients
router.get('/clients', async (req, res, next) => {
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

router.post('/clients', authorizeRole('company'), async (req, res, next) => {
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

// Tasks
router.get('/tasks', async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = allowedTaskStatuses.includes(req.query.status) ? req.query.status : null;
    const assigneeId = positiveInteger(req.query.assigneeId, 0, 1000000000);
    const projectId = positiveInteger(req.query.projectId, 0, 1000000000);

    const where = ['company_id = $1'];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`title ILIKE $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (assigneeId) {
      values.push(assigneeId);
      where.push(`assignee_id = $${values.length}`);
    }
    if (projectId) {
      values.push(projectId);
      where.push(`project_id = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const tasks = await pool.query(
      `SELECT id, title, status, priority, due_date, project_id, assignee_id, created_at
       FROM tasks ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM tasks ${whereClause}`, values);

    res.json({ success: true, data: tasks.rows, pagination: { page, limit, total: count.rows[0].total } });
  } catch (error) {
    next(error);
  }
});

router.post('/tasks', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const { title, description, projectId, assigneeId, dueDate, priority = 'medium' } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid task priority' });
    }

    const project = await pool.query('SELECT id FROM projects WHERE id = $1 AND company_id = $2', [projectId, req.company.id]);
    if (!project.rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found in this company' });
    }

    if (assigneeId) {
      const assignee = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [assigneeId, req.company.id]);
      if (!assignee.rows[0]) {
        return res.status(404).json({ success: false, message: 'Assignee not found in this company' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, project_id, company_id, assignee_id, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7)
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at`,
      [title.trim(), description || null, projectId, req.company.id, assigneeId || null, priority, dueDate || null]
    );

    res.status(201).json({ success: true, message: 'Task created', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.project_id, p.name AS project_name,
              t.assignee_id, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.put('/tasks/:taskId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    const { title, description, assigneeId, dueDate, priority, status } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }
    if (status && !allowedTaskStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid task status' });
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid task priority' });
    }
    if (assigneeId) {
      const assignee = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [assigneeId, req.company.id]);
      if (!assignee.rows[0]) {
        return res.status(404).json({ success: false, message: 'Assignee not found in this company' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE tasks SET
         title = COALESCE(NULLIF($1, ''), title),
         description = COALESCE($2, description),
         assignee_id = COALESCE($3, assignee_id),
         due_date = COALESCE($4, due_date),
         priority = COALESCE(NULLIF($5, ''), priority),
         status = COALESCE(NULLIF($6, ''), status),
         updated_at = NOW()
       WHERE id = $7 AND company_id = $8
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at`,
      [title, description, assigneeId || null, dueDate || null, priority, status, taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, message: 'Task updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.patch('/tasks/:taskId/status', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    const { status } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }
    if (!allowedTaskStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid task status' });
    }

    const { rows } = await pool.query(
      'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING id, title, status, priority, due_date, assignee_id, project_id',
      [status, taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, message: 'Task status updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// Reports
router.get('/reports/summary', async (req, res, next) => {
  try {
    const companyId = req.company.id;
    const [projectStatus, taskStatus, employeeStatus, teamLoad] = await Promise.all([
      pool.query(`SELECT status, COUNT(*)::int AS count FROM projects WHERE company_id = $1 GROUP BY status`, [companyId]),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM tasks WHERE company_id = $1 GROUP BY status`, [companyId]),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM users WHERE company_id = $1 AND role IN ('team_leader', 'team_member') GROUP BY status`, [companyId]),
      pool.query(`SELECT t.id, t.name, COUNT(u.id)::int AS member_count FROM teams t LEFT JOIN users u ON u.team_id = t.id WHERE t.company_id = $1 GROUP BY t.id, t.name ORDER BY member_count DESC LIMIT 10`, [companyId]),
    ]);

    res.json({
      success: true,
      data: {
        project_status: projectStatus.rows,
        task_status: taskStatus.rows,
        employee_status: employeeStatus.rows,
        teams: teamLoad.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
