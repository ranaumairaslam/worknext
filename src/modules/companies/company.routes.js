const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router();

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const validateEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim());

// =======================
// Public signup routing
// =======================

const companyPayload = (body) => ({
  companyName: body.companyName?.trim(),
  name: body.name?.trim(),
  email: body.email?.trim().toLowerCase(),
  password: body.password,
  phone: body.phone?.trim() || null,
  address: body.address?.trim() || null,
  industry: body.industry?.trim() || null,
  website: body.website?.trim() || null,
});

const validateCompanyPayload = (company) => {
  if (!company.companyName || !company.name || !company.email || !company.password) return 'Company name, contact name, email, and password are required';
  if (!validateEmail(company.email)) return 'Please provide a valid email address';
  if (company.password.length < 6) return 'Password must be at least 6 characters long';
  return null;
};

async function createCompanyAccount(data) {
  const company = companyPayload(data);
  const err = validateCompanyPayload(company);
  if (err) {
    const e = new Error(err);
    e.statusCode = 400;
    throw e;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [company.email]);
    if (existing.rows[0]) {
      const e = new Error('An account with this email already exists');
      e.statusCode = 409;
      throw e;
    }
    const passwordHash = await bcrypt.hash(company.password, 10);
    const user = await client.query("INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,'company') RETURNING id, name, email, role, created_at", [company.name, company.email, passwordHash]);
    const createdCompany = await client.query('INSERT INTO companies (name, owner_id, email, phone, address, industry, website) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, owner_id, email, phone, address, industry, website, status, created_at, updated_at', [company.companyName, user.rows[0].id, company.email, company.phone, company.address, company.industry, company.website]);
    await client.query('UPDATE users SET company_id = $1 WHERE id = $2', [createdCompany.rows[0].id, user.rows[0].id]);
    await client.query('COMMIT');
    return { user: user.rows[0], company: createdCompany.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// POST /api/company/signup - Public Company Signup
router.post('/signup', async (req, res, next) => {
  try {
    const account = await createCompanyAccount(req.body);
    res.status(201).json({ success: true, message: 'Company registered successfully', data: account });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
});

// =======================
// Protected routes
// =======================

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

// Apply auth and company loading middleware to all following endpoints
router.use(protect, loadCompany);

// GET /api/company/dashboard - Company Admin Dashboard stats
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

// GET /api/company/profile - Get company profile
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

// PUT /api/company/profile - Update company profile
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

// Mount Sub-routers
router.use('/projects', require('../projects/project.routes'));
router.use('/teams', require('../teams/team.routes'));
router.use('/employees', require('../employees/employee.routes'));
router.use('/clients', require('../clients/client.routes'));
router.use('/tasks', require('../tasks/task.routes'));
router.use('/reports', require('../reports/report.routes'));

module.exports = router;
