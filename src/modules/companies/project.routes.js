const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access",
      });
    }

    next();
  };
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
// GET ALL PROJECTS
// =====================================================

router.get("/", async (req, res, next) => {
  try {
    const projects = await pool.query(
      `

SELECT

p.*,

t.name AS team_name,

u.name AS project_leader_name


FROM projects p


LEFT JOIN teams t

ON t.id=p.team_id



LEFT JOIN users u

ON u.id=p.project_leader_id



WHERE p.company_id=$1


ORDER BY p.created_at DESC


`,

      [req.company.id],
    );

    res.json({
      success: true,

      data: projects.rows,
    });
  } catch (error) {
    next(error);
  }
});

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
// GET SINGLE PROJECT
// =====================================================

router.get(
  "/:projectId",

  async (req, res, next) => {
    try {
      const project = await pool.query(
        `

SELECT

p.*,

t.name AS team_name,

u.name AS project_leader


FROM projects p


LEFT JOIN teams t
ON t.id=p.team_id


LEFT JOIN users u
ON u.id=p.project_leader_id


WHERE p.id=$1
AND p.company_id=$2


`,

        [req.params.projectId, req.company.id],
      );

      if (!project.rows[0]) {
        return res.status(404).json({
          success: false,
          message: "Project not found",
        });
      }

      res.json({
        success: true,

        data: project.rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
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

module.exports = router;