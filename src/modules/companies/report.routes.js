const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });

async function loadCompany(req, res, next) {
  if (req.company) return next();
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
// WORKFLOW STEP 7: GENERATE REPORTS
// (Pulls together everything created in steps 2-6:
//  teams, leaders, projects, assignments, task progress)
// =======================================================

// GET /api/company/reports/projects - Project status report
router.get('/projects', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id, p.name, p.status, p.start_date, p.due_date,
         t.name AS team_name,
         leader.name AS team_leader_name,
         cl.name AS client_name,
         COUNT(tk.id)::int AS total_tasks,
         COUNT(tk.id) FILTER (WHERE tk.status = 'done')::int AS completed_tasks,
         COALESCE(ROUND(100.0 * SUM(CASE WHEN tk.status = 'done' THEN 1 ELSE 0 END) / NULLIF(COUNT(tk.id), 0)), 0)::int AS progress_percent
       FROM projects p
       LEFT JOIN teams t ON t.id = p.team_id
       LEFT JOIN users leader ON leader.id = t.leader_id
       LEFT JOIN clients cl ON cl.id = p.client_id
       LEFT JOIN tasks tk ON tk.project_id = p.id
       WHERE p.company_id = $1
       GROUP BY p.id, t.name, leader.name, cl.name
       ORDER BY p.created_at DESC`,
      [req.company.id]
    );

    res.json({
      success: true,
      report: 'Project Status Report',
      generated_at: new Date().toISOString(),
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/reports/teams - Team performance report
router.get('/teams', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         t.id, t.name AS team_name,
         leader.name AS leader_name,
         COUNT(DISTINCT members.id)::int AS member_count,
         COUNT(DISTINCT p.id)::int AS total_projects,
         COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'completed')::int AS completed_projects,
         COUNT(tk.id)::int AS total_tasks,
         COUNT(tk.id) FILTER (WHERE tk.status = 'done')::int AS completed_tasks
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       LEFT JOIN users members ON members.team_id = t.id
       LEFT JOIN projects p ON p.team_id = t.id
       LEFT JOIN tasks tk ON tk.project_id = p.id
       WHERE t.company_id = $1
       GROUP BY t.id, leader.name
       ORDER BY t.name`,
      [req.company.id]
    );

    res.json({
      success: true,
      report: 'Team Performance Report',
      generated_at: new Date().toISOString(),
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/reports/clients - Client summary report
router.get('/clients', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         cl.id, cl.name AS client_name, cl.email, cl.company_name,
         COUNT(p.id)::int AS total_projects,
         COUNT(p.id) FILTER (WHERE p.status = 'active')::int AS active_projects,
         COUNT(p.id) FILTER (WHERE p.status = 'completed')::int AS completed_projects,
         cl.created_at AS client_since
       FROM clients cl
       LEFT JOIN projects p ON p.client_id = cl.id
       WHERE cl.company_id = $1
       GROUP BY cl.id
       ORDER BY cl.created_at DESC`,
      [req.company.id]
    );

    res.json({
      success: true,
      report: 'Client Summary Report',
      generated_at: new Date().toISOString(),
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/reports/revenue - Revenue report (optionally by date range)
router.get('/revenue', async (req, res, next) => {
  try {
    const { from, to } = req.query;

    const params = [req.company.id];
    let dateFilter = '';
    if (from) {
      params.push(from);
      dateFilter += ` AND created_at >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      dateFilter += ` AND created_at <= $${params.length}`;
    }

    const totalResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS total_revenue,
              COUNT(*)::int AS total_transactions
       FROM revenues
       WHERE company_id = $1 ${dateFilter}`,
      params
    );

    const monthlyResult = await pool.query(
      `SELECT
         TO_CHAR(created_at, 'YYYY-MM') AS month,
         COALESCE(SUM(amount), 0)::numeric(14,2) AS revenue
       FROM revenues
       WHERE company_id = $1 ${dateFilter}
       GROUP BY TO_CHAR(created_at, 'YYYY-MM')
       ORDER BY month DESC
       LIMIT 12`,
      params
    );

    res.json({
      success: true,
      report: 'Revenue Report',
      generated_at: new Date().toISOString(),
      data: {
        total_revenue: Number(totalResult.rows[0].total_revenue),
        total_transactions: totalResult.rows[0].total_transactions,
        monthly_breakdown: monthlyResult.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/reports/summary - One combined executive summary
router.get('/summary', async (req, res, next) => {
  try {
    const companyId = req.company.id;

    const [teams, projects, clients, revenue, tasks] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total FROM teams WHERE company_id = $1', [companyId]),
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'active')::int AS active,
               COUNT(*) FILTER (WHERE status = 'completed')::int AS completed
        FROM projects WHERE company_id = $1
      `, [companyId]),
      pool.query('SELECT COUNT(*)::int AS total FROM clients WHERE company_id = $1', [companyId]),
      pool.query('SELECT COALESCE(SUM(amount), 0)::numeric(14,2) AS total FROM revenues WHERE company_id = $1', [companyId]),
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'done')::int AS completed
        FROM tasks WHERE company_id = $1
      `, [companyId]),
    ]);

    res.json({
      success: true,
      report: 'Executive Summary',
      generated_at: new Date().toISOString(),
      data: {
        teams: teams.rows[0].total,
        projects: projects.rows[0],
        clients: clients.rows[0].total,
        total_revenue: Number(revenue.rows[0].total),
        tasks: tasks.rows[0],
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;