const express = require('express');
const pool = require('../../config/db');

const router = Router = express.Router();

// GET /api/company/reports/summary - Get company report summaries
router.get('/summary', async (req, res, next) => {
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
