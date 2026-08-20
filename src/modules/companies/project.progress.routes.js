const express = require('express');
const protect = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const { normalizeRole } = require('../../middleware/role.middleware');

const router = express.Router({ mergeParams: true });

const authorizeRole = (...roles) => (req, res, next) => {
  const allowed = roles.map((role) => normalizeRole(role));
  if (!allowed.includes(normalizeRole(req.user?.role))) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

async function loadCompany(req, res, next) {
  if (req.company) return next();
  try {
    const result = await pool.query(
      'SELECT company_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const companyId = result.rows[0]?.company_id || req.user.companyId;
    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: 'User does not belong to a company',
      });
    }
    req.company = { id: companyId };
    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCompany);

// Small helper: verify the project belongs to the admin's company before touching it
async function getCompanyProject(projectId, companyId) {
  const { rows } = await pool.query(
    `SELECT id, name, status FROM projects WHERE id = $1 AND company_id = $2`,
    [projectId, companyId]
  );
  return rows[0] || null;
}

// POST /api/company/projects/:id/progress
// Company admin logs a new progress update. This is the ONLY write path for
// progress — client, team member, and team leader dashboards all just read
// from progress_reports, so this single insert shows up everywhere.
router.post('/:id/progress', authorizeRole('company'), async (req, res, next) => {
  try {
    const { title, description, percentage } = req.body;

    if (!title || percentage === undefined || percentage === null) {
      return res.status(400).json({ success: false, message: 'title and percentage are required' });
    }
    const pct = Number(percentage);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      return res.status(400).json({ success: false, message: 'percentage must be a number between 0 and 100' });
    }

    const project = await getCompanyProject(req.params.id, req.company.id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: reportRows } = await client.query(
        `INSERT INTO progress_reports (project_id, title, description, percentage, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, project_id, title, description, percentage, created_by, created_at`,
        [project.id, title.trim(), description ? description.trim() : null, pct, req.user.id]
      );

      // Optional denormalized convenience: auto-close the project when it hits 100%
      let newStatus = project.status;
      if (pct === 100 && project.status !== 'completed') {
        newStatus = 'completed';
        await client.query(`UPDATE projects SET status = $1 WHERE id = $2`, [newStatus, project.id]);
      }

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Progress updated',
        data: {
          report: reportRows[0],
          project: { id: project.id, name: project.name, status: newStatus },
        },
      });
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

// GET /api/company/projects/:id/progress
// Admin view of the full progress history for a project (mirrors what the
// client, team member, and team leader dashboards each show for the same project).
router.get('/:id/progress', authorizeRole('company'), async (req, res, next) => {
  try {
    const project = await getCompanyProject(req.params.id, req.company.id);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const { rows: reports } = await pool.query(
      `SELECT id, title, description, percentage, created_by, created_at
       FROM progress_reports
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        project,
        latest_percentage: reports[0]?.percentage ?? 0,
        reports,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;