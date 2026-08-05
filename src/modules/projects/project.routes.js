const express = require("express");
const pool = require("../../config/db");

const router = express.Router();

const allowedProjectStatuses = ["active", "inactive", "completed"];

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You do not have access to this resource",
        });
    }
    next();
  };

// GET /api/company/projects - List projects
router.get("/", async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const status = allowedProjectStatuses.includes(req.query.status)
      ? req.query.status
      : null;

    const where = ["company_id = $1"];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`name ILIKE $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const projects = await pool.query(
      `SELECT id, name, status, created_at FROM projects ${whereClause} ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM projects ${whereClause}`,
      values,
    );

    res.json({
      success: true,
      data: projects.rows,
      pagination: { page, limit, total: count.rows[0].total },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/company/projects - Create project
router.post(
  "/",
  authorizeRole("company", "team_leader"),
  async (req, res, next) => {
    try {
      const { name, status = "active" } = req.body;
      if (!name || !String(name).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Project name is required" });
      }
      if (status && !allowedProjectStatuses.includes(status)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid project status" });
      }

      const { rows } = await pool.query(
        "INSERT INTO projects (name, company_id, status) VALUES ($1, $2, $3) RETURNING id, name, status, created_at",
        [name.trim(), req.company.id, status],
      );

      res
        .status(201)
        .json({ success: true, message: "Project created", data: rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

// TEAM LEADER DASHBOARD — projects led by logged-in user
router.get(
  "/leader/my-projects",
  authorizeRole("team_leader"),
  async (req, res, next) => {
    try {
      const projects = await pool.query(
        `
      SELECT
        p.*,
        t.name AS team_name
      FROM projects p
      LEFT JOIN teams t ON t.id = p.team_id
      WHERE p.project_leader_id = $1
      AND p.company_id = $2
      ORDER BY p.created_at DESC
      `,
        [req.user.id, req.company.id],
      );

      res.json({ success: true, data: projects.rows });
    } catch (error) {
      next(error);
    }
  },
);

// team members under a leader's team, for a given project
router.get(
  "/leader/:projectId/team-members",
  authorizeRole("team_leader"),
  async (req, res, next) => {
    try {
      const project = await pool.query(
        `SELECT team_id FROM projects
       WHERE id=$1 AND company_id=$2 AND project_leader_id=$3`,
        [req.params.projectId, req.company.id, req.user.id],
      );

      if (!project.rows[0]) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Project not found or you are not its leader",
          });
      }

      const members = await pool.query(
        `SELECT id, name, email, role
       FROM users
       WHERE team_id=$1 AND company_id=$2`,
        [project.rows[0].team_id, req.company.id],
      );

      res.json({ success: true, data: members.rows });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/company/projects/:projectId - Get single project
router.get("/:projectId", async (req, res, next) => {
  try {
    const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid project id" });
    }

    const { rows } = await pool.query(
      "SELECT id, name, status, created_at FROM projects WHERE id = $1 AND company_id = $2",
      [projectId, req.company.id],
    );
    if (!rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: "Project not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/projects/:projectId - Update project
router.put(
  "/:projectId",
  authorizeRole("company", "team_leader"),
  async (req, res, next) => {
    try {
      const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
      if (!projectId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid project id" });
      }

      const { name, status } = req.body;
      if (status && !allowedProjectStatuses.includes(status)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid project status" });
      }

      const { rows } = await pool.query(
        `UPDATE projects SET
         name = COALESCE(NULLIF($1, ''), name),
         status = COALESCE(NULLIF($2, ''), status)
       WHERE id = $3 AND company_id = $4
       RETURNING id, name, status, created_at`,
        [name, status, projectId, req.company.id],
      );

      if (!rows[0]) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      res.json({ success: true, message: "Project updated", data: rows[0] });
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /api/company/projects/:projectId/status - Update project status
router.patch(
  "/:projectId/status",
  authorizeRole("company", "team_leader"),
  async (req, res, next) => {
    try {
      const projectId = positiveInteger(req.params.projectId, 0, 1000000000);
      const { status } = req.body;
      if (!projectId) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid project id" });
      }
      if (!allowedProjectStatuses.includes(status)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Status must be active, inactive, or completed",
          });
      }

      const { rows } = await pool.query(
        "UPDATE projects SET status = $1 WHERE id = $2 AND company_id = $3 RETURNING id, name, status, created_at",
        [status, projectId, req.company.id],
      );
      if (!rows[0]) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }

      res.json({
        success: true,
        message: "Project status updated",
        data: rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
