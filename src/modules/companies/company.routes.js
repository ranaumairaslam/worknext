console.log("✅ company.routes.js loaded");


const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router();

const validateEmail = (value) => /^\S+@\S+\.\S+$/.test(String(value || '').trim());

// =======================================================
// WORKFLOW STEP 1: LOGIN
// (Handled by /api/auth/login - see auth.routes.js)
// This file picks up AFTER login, once a company admin
// has a valid JWT token.
// =======================================================

// Middleware: Load the logged-in admin's company into req.company
async function loadCompany(req, res, next) {
  try {
    const userResult = await pool.query('SELECT company_id FROM users WHERE id = $1', [req.user.id]);
    const companyId = userResult.rows[0]?.company_id || req.user.companyId;

    if (!companyId) {
      return res.status(403).json({ success: false, message: 'User does not belong to a company' });
    }

    const companyResult = await pool.query(
      'SELECT id, name, status, email, phone, address, industry, website FROM companies WHERE id = $1',
      [companyId]
    );

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

// All routes below require a valid token + company context
router.use(protect, loadCompany);

// =======================================================
// PUBLIC-TO-COMPANY: PROFILE
// =======================================================

// GET /api/company/profile
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

// PUT /api/company/profile
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

// =======================================================
// WORKFLOW STEP 6: MONITOR PROGRESS
// (Dashboard aggregates data created in steps 2-5:
//  teams, team leaders, projects, project assignments)
// =======================================================

// GET /api/company/dashboard - Overall progress snapshot
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

      pool.query(`
        SELECT
          COUNT(*)::int AS total_teams,
          COUNT(*) FILTER (WHERE leader_id IS NOT NULL)::int AS teams_with_leader,
          COUNT(*) FILTER (WHERE leader_id IS NULL)::int AS teams_without_leader
        FROM teams
        WHERE company_id = $1
      `, [companyId]),

      pool.query('SELECT COUNT(*)::int AS total_clients FROM clients WHERE company_id = $1', [companyId]),

      pool.query(`
        SELECT
          COUNT(*)::int AS total_employees,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_employees,
          COUNT(*) FILTER (WHERE role = 'team_leader')::int AS total_team_leaders
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

      // Per-project progress, including assigned team + leader (steps 3-5 combined)
      pool.query(`
        SELECT
          p.id AS project_id,
          p.name AS project_name,
          p.status,
          t.id AS team_id,
          t.name AS team_name,
          leader.id AS team_leader_id,
          leader.name AS team_leader_name,
          cl.id AS client_id,
          cl.name AS client_name,
          COALESCE(ROUND(100.0 * SUM(CASE WHEN tk.status = 'done' THEN 1 ELSE 0 END) / NULLIF(COUNT(tk.id), 0)), 0)::int AS progress
        FROM projects p
        LEFT JOIN teams t ON t.id = p.team_id
        LEFT JOIN users leader ON leader.id = t.leader_id
        LEFT JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN tasks tk ON tk.project_id = p.id
        WHERE p.company_id = $1
        GROUP BY p.id, p.name, p.status, t.id, t.name, leader.id, leader.name, cl.id, cl.name
        ORDER BY p.created_at DESC
        LIMIT 10
      `, [companyId]),
    ]);

    res.json({
      success: true,
      data: {
        company: req.company,
        teams: teamSummary.rows[0],
        employees: employeeSummary.rows[0],
        clients: clientSummary.rows[0].total_clients,
        projects: projectSummary.rows[0],
        tasks: taskSummary.rows[0],
        total_revenue: Number(revenueSummary.rows[0].total_revenue),
        project_progress: projectProgress.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// =======================================================
// Mount sub-routers in workflow order:
// Teams -> Projects -> Clients -> Reports
// =======================================================
router.use('/teams', require('./team.routes'));
router.use('/projects', require('./project.routes'));
router.use('/employees', require('../employees/employee.routes'));
router.use('/clients', require('./client.routes'));
router.use('/tasks', require('../tasks/task.routes'));
router.use('/meetings', require('./meeting.routes'));
router.use('/scheduledMeetings', require('./meeting.routes'));
router.use('/scheduled-meetings', require('./meeting.routes'));
router.use('/member-invites', require('./member-invite.routes'));
router.use('/memberInvites', require('./member-invite.routes'));
router.use('/revenues', require('./revenue.routes'));
router.use('/project-revenues', require('./revenue.routes'));
router.use('/projectRevenues', require('./revenue.routes'));
router.use('/reports', require('./report.routes'));

module.exports = router;
module.exports.loadCompany = loadCompany;
module.exports.authorizeRole = authorizeRole;