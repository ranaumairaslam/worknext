const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: "You do not have access",
      });
    }

    next();
  };
};

const methodNotAllowed = (allowed) => (req, res) => {
  res.set("Allow", allowed.join(", "));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(", ")}`,
  });
};

// Accepts: "17" | "projectId:17" | "projectId/17" style values
const parseProjectId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:projectId[:/])?(\d+)$/i);
  if (!matched) return null;
  const id = Number.parseInt(matched[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function loadCompany(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT company_id FROM users WHERE id=$1",

      [req.user.id],
    );

    const companyId = result.rows[0]?.company_id || req.user.companyId;

    if (!companyId) {
      return res.status(403).json({
        success: false,
        message: "User does not belong to company",
      });
    }

    req.company = {
      id: companyId,
    };

    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCompany);

// =====================================================
// CREATE PROJECT
// =====================================================

router.post(
  "/",
  authorizeRole("company", "super_admin"),

  async (req, res, next) => {
    try {
      const { name, description, clientId, startDate, dueDate } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Project name required",
        });
      }

      const project = await pool.query(
        `

INSERT INTO projects

(
company_id,
name,
description,
client_id,
status,
start_date,
due_date,
created_at
)


VALUES

($1,$2,$3,$4,'pending',$5,$6,NOW())


RETURNING *

`,

        [
          req.company.id,
          name,
          description || null,
          clientId || null,
          startDate || null,
          dueDate || null,
        ],
      );

      res.status(201).json({
        success: true,

        message: "Project created",

        data: project.rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
);

// =====================================================
// GET ALL PROJECTS for a company
// GET /api/company/projects
// GET /api/company/projects?companyId=15
// Company role can only query their own companyId.
// =====================================================

router.get("/", async (req, res, next) => {
  try {
    let targetCompanyId = req.company.id;

    if (req.query.companyId !== undefined && req.query.companyId !== "") {
      const requestedId = Number.parseInt(req.query.companyId, 10);
      if (!Number.isInteger(requestedId) || requestedId <= 0) {
        return res.status(400).json({
          success: false,
          code: 400,
          message: "Invalid companyId",
        });
      }

      if (req.user.role === "company" && requestedId !== Number(req.company.id)) {
        return res.status(403).json({
          success: false,
          code: 403,
          message: "You can only view projects of your own company",
        });
      }

      targetCompanyId = requestedId;
    }

    const companyCheck = await pool.query(
      `SELECT id, name, email, status FROM companies WHERE id = $1`,
      [targetCompanyId],
    );
    if (!companyCheck.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: "Company not found",
      });
    }

    const projects = await pool.query(
      `
      SELECT
        p.id,
        p.company_id,
        p.name,
        p.description,
        p.status,
        p.client_id,
        p.team_id,
        p.project_leader_id,
        p.start_date,
        p.due_date,
        p.end_date,
        p.created_at,
        t.name AS team_name,
        u.name AS project_leader_name,
        cl.name AS client_name,
        cl.company_name AS client_company_name
      FROM projects p
      LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN users u ON u.id = p.project_leader_id
      LEFT JOIN clients cl ON cl.id = p.client_id
      WHERE p.company_id = $1
      ORDER BY p.created_at DESC
      `,
      [targetCompanyId],
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Projects fetched successfully",
      count: projects.rows.length,
      companyId: targetCompanyId,
      company: {
        id: companyCheck.rows[0].id,
        name: companyCheck.rows[0].name,
        email: companyCheck.rows[0].email,
        status: companyCheck.rows[0].status,
      },
      data: projects.rows,
    });
  } catch (error) {
    next(error);
  }
});

// Method validation for collection route
router.all("/", methodNotAllowed(["GET", "POST"]));

// =====================================================
// TEAM LEADER DASHBOARD — projects led by logged-in user
// =====================================================

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

      res.json({
        success: true,
        data: projects.rows,
      });
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
        return res.status(404).json({
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

      res.json({
        success: true,
        data: members.rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

// =====================================================
// GET / UPDATE SINGLE PROJECT
// Supported URLs:
//   GET|PUT|PATCH /api/company/projects/17
//   GET|PUT|PATCH /api/company/projects/projectId/17
//   GET|PUT|PATCH /api/company/projects/projectId:17
// =====================================================

async function getProjectHandler(req, res, next) {
  try {
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: "Invalid project id. Use /projects/17 or /projects/projectId/17",
      });
    }

    const project = await pool.query(
      `
      SELECT
        p.*,
        t.name AS team_name,
        u.name AS project_leader
      FROM projects p
      LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN users u ON u.id = p.project_leader_id
      WHERE p.id = $1 AND p.company_id = $2
      `,
      [projectId, req.company.id],
    );

    if (!project.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: "Project not found",
      });
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project fetched successfully",
      data: project.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

async function updateProjectHandler(req, res, next) {
  try {
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: "Invalid project id. Use /projects/17 or /projects/projectId/17",
      });
    }

    const { name, description, clientId, startDate, dueDate, status } =
      req.body || {};

    const hasAnyField = [
      name,
      description,
      clientId,
      startDate,
      dueDate,
      status,
    ].some((value) => value !== undefined);
    if (!hasAnyField) {
      return res.status(400).json({
        success: false,
        code: 400,
        message:
          "Provide at least one field to update: name, description, clientId, startDate, dueDate, status",
      });
    }

    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: "Project name cannot be empty",
      });
    }

    const project = await pool.query(
      `
      UPDATE projects SET
        name = COALESCE(NULLIF($1, ''), name),
        description = COALESCE($2, description),
        client_id = COALESCE($3, client_id),
        start_date = COALESCE($4, start_date),
        due_date = COALESCE($5, due_date),
        status = COALESCE(NULLIF($6, ''), status)
      WHERE id = $7 AND company_id = $8
      RETURNING *
      `,
      [
        name !== undefined ? String(name).trim() : null,
        description !== undefined ? description : null,
        clientId !== undefined ? clientId : null,
        startDate !== undefined ? startDate : null,
        dueDate !== undefined ? dueDate : null,
        status !== undefined ? status : null,
        projectId,
        req.company.id,
      ],
    );

    if (!project.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: "Project not found for your company",
      });
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project updated successfully",
      data: project.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

// Explicit style: /api/company/projects/projectId/17
router.get("/projectId/:projectId", getProjectHandler);
router.put(
  "/projectId/:projectId",
  authorizeRole("company", "super_admin"),
  updateProjectHandler,
);
router.patch(
  "/projectId/:projectId",
  authorizeRole("company", "super_admin"),
  updateProjectHandler,
);
router.all(
  "/projectId/:projectId",
  methodNotAllowed(["GET", "PUT", "PATCH"]),
);

// Short style: /api/company/projects/17
// Also supports /api/company/projects/projectId:17
router.get("/:projectId", getProjectHandler);
router.put(
  "/:projectId",
  authorizeRole("company", "super_admin"),
  updateProjectHandler,
);
router.patch(
  "/:projectId",
  authorizeRole("company", "super_admin"),
  updateProjectHandler,
);

// =====================================================
// GET TEAM EMPLOYEES FOR PROJECT ASSIGN
// =====================================================

router.get(
  "/:projectId/team/:teamId/employees",

  async (req, res, next) => {
    try {
      const employees = await pool.query(
        `

SELECT

id,
name,
email,
role


FROM users


WHERE team_id=$1
AND company_id=$2


`,

        [req.params.teamId, req.company.id],
      );

      res.json({
        success: true,

        data: employees.rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

// =====================================================
// GET ALL COMPANY EMPLOYEES (for leader selection — any employee,
// not restricted to a specific team)
// =====================================================

router.get(
  "/company/employees",

  authorizeRole("company", "super_admin"),

  async (req, res, next) => {
    try {
      const employees = await pool.query(
        `

SELECT

id,
name,
email,
role,
team_id


FROM users


WHERE company_id=$1


ORDER BY name ASC


`,

        [req.company.id],
      );

      res.json({
        success: true,

        data: employees.rows,
      });
    } catch (error) {
      next(error);
    }
  },
);

// =====================================================
// ASSIGN PROJECT + PROJECT LEADER
// =====================================================

router.put(
  "/:projectId/assign-team",

  authorizeRole("company", "super_admin"),

  async (req, res, next) => {
    try {
      const { teamId, leaderId } = req.body;

      if (!teamId || !leaderId) {
        return res.status(400).json({
          success: false,

          message: "teamId and leaderId required",
        });
      }

      // check team

      const team = await pool.query(
        `

SELECT id,name

FROM teams

WHERE id=$1
AND company_id=$2

`,

        [teamId, req.company.id],
      );

      if (!team.rows[0]) {
        return res.status(404).json({
          success: false,

          message: "Team not found",
        });
      }

      // check employee — any employee in the company, not restricted
      // to already being a member of this team

      const employee = await pool.query(
        `

SELECT id,name,email

FROM users


WHERE id=$1

AND company_id=$2


`,

        [leaderId, req.company.id],
      );

      if (!employee.rows[0]) {
        return res.status(404).json({
          success: false,

          message: "Employee not found in this company",
        });
      }

      // change role + move employee into the team they now lead

      await pool.query(
        `

UPDATE users

SET role='team_leader', team_id=$1

WHERE id=$2

`,

        [teamId, leaderId],
      );

      // assign team leader

      await pool.query(
        `

UPDATE teams

SET leader_id=$1

WHERE id=$2


`,

        [leaderId, teamId],
      );

      // assign project

      const project = await pool.query(
        `

UPDATE projects


SET

team_id=$1,

project_leader_id=$2,

status='active',

updated_at=NOW()


WHERE id=$3

AND company_id=$4



RETURNING *


`,

        [teamId, leaderId, req.params.projectId, req.company.id],
      );

      res.json({
        success: true,

        message: "Project assigned and team leader created",

        data: {
          project: project.rows[0],

          leader: employee.rows[0],
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Method validation fallback for /:projectId (after nested routes)
router.all("/:projectId", methodNotAllowed(["GET", "PUT", "PATCH"]));

module.exports = router;