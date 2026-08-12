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

const ALLOWED_PROJECT_STATUSES = [
  "pending",
  "active",
  "inactive",
  "completed",
  "on_hold",
];
const ALLOWED_PROJECT_PRIORITIES = ["low", "medium", "high", "urgent"];

const sendError = (res, status, message, errors = null) => {
  const payload = { success: false, code: status, message };
  if (errors) payload.errors = errors;
  return res.status(status).json(payload);
};

const pickCreateProjectBody = (body = {}) => ({
  projectName: body.projectName ?? body.name,
  description: body.description ?? body.descrioptin,
  teamLeaderName: body.TeamLeaderName ?? body.teamLeaderName,
  projectTeam: body.ProjectTeam ?? body.projectTeam,
  projectStatus: body.ProjectStatus ?? body.projectStatus ?? body.status,
  projectPriority:
    body.ProjectPriority ??
    body.ProjectPrority ??
    body.projectPriority ??
    body.priority,
  date: body.date ?? body.dueDate ?? body.startDate,
  clientName: body.clientName ?? body.ClientName,
});

function validateCreateProject(body) {
  const data = pickCreateProjectBody(body);
  const errors = [];

  if (!data.projectName || !String(data.projectName).trim()) {
    errors.push({ field: "projectName", message: "projectName is required" });
  }
  if (!data.description || !String(data.description).trim()) {
    errors.push({ field: "description", message: "description is required" });
  }
  if (!data.teamLeaderName || !String(data.teamLeaderName).trim()) {
    errors.push({
      field: "TeamLeaderName",
      message: "TeamLeaderName is required",
    });
  }
  if (!data.projectTeam || !String(data.projectTeam).trim()) {
    errors.push({ field: "ProjectTeam", message: "ProjectTeam is required" });
  }
  if (!data.projectStatus || !String(data.projectStatus).trim()) {
    errors.push({
      field: "ProjectStatus",
      message: "ProjectStatus is required",
    });
  } else if (
    !ALLOWED_PROJECT_STATUSES.includes(
      String(data.projectStatus).trim().toLowerCase(),
    )
  ) {
    errors.push({
      field: "ProjectStatus",
      message: `ProjectStatus must be one of: ${ALLOWED_PROJECT_STATUSES.join(", ")}`,
    });
  }
  if (!data.projectPriority || !String(data.projectPriority).trim()) {
    errors.push({
      field: "ProjectPriority",
      message: "ProjectPriority is required",
    });
  } else if (
    !ALLOWED_PROJECT_PRIORITIES.includes(
      String(data.projectPriority).trim().toLowerCase(),
    )
  ) {
    errors.push({
      field: "ProjectPriority",
      message: `ProjectPriority must be one of: ${ALLOWED_PROJECT_PRIORITIES.join(", ")}`,
    });
  }
  if (!data.date || !String(data.date).trim()) {
    errors.push({ field: "date", message: "date is required" });
  } else if (Number.isNaN(Date.parse(String(data.date))) ) {
    errors.push({ field: "date", message: "date must be a valid date" });
  }
  if (!data.clientName || !String(data.clientName).trim()) {
    errors.push({ field: "clientName", message: "clientName is required" });
  }

  return { data, errors };
}

// =====================================================
// CREATE PROJECT
// POST /api/company/projects
// Body: projectName, description, TeamLeaderName, ProjectTeam,
//       ProjectStatus, ProjectPriority, date, clientName
// =====================================================

router.post(
  "/",
  authorizeRole("company", "super_admin", "team_leader"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { data, errors } = validateCreateProject(req.body);
      if (errors.length) {
        return sendError(res, 400, "Validation failed", errors);
      }

      const projectName = String(data.projectName).trim();
      const description = String(data.description).trim();
      const teamLeaderName = String(data.teamLeaderName).trim();
      const projectTeam = String(data.projectTeam).trim();
      const projectStatus = String(data.projectStatus).trim().toLowerCase();
      const projectPriority = String(data.projectPriority).trim().toLowerCase();
      const projectDate = String(data.date).trim();
      const clientName = String(data.clientName).trim();

      await client.query("BEGIN");

      // Resolve team by id or name (within company)
      let team;
      const teamIdCandidate = Number.parseInt(projectTeam, 10);
      if (Number.isInteger(teamIdCandidate) && String(teamIdCandidate) === projectTeam) {
        const teamById = await client.query(
          `SELECT id, name, leader_id FROM teams WHERE id = $1 AND company_id = $2`,
          [teamIdCandidate, req.company.id],
        );
        team = teamById.rows[0];
      } else {
        const teamByName = await client.query(
          `SELECT id, name, leader_id FROM teams
           WHERE company_id = $1 AND LOWER(name) = LOWER($2)
           ORDER BY id DESC LIMIT 1`,
          [req.company.id, projectTeam],
        );
        team = teamByName.rows[0];
      }

      if (!team) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "ProjectTeam not found in your company", [
          { field: "ProjectTeam", message: `No team found for "${projectTeam}"` },
        ]);
      }

      // Resolve team leader by name (within company)
      const leaderResult = await client.query(
        `SELECT id, name, email, role, team_id FROM users
         WHERE company_id = $1
           AND LOWER(name) = LOWER($2)
           AND role IN ('team_leader', 'team_member', 'company')
         ORDER BY id DESC LIMIT 1`,
        [req.company.id, teamLeaderName],
      );
      const leader = leaderResult.rows[0];
      if (!leader) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "TeamLeaderName not found in your company", [
          {
            field: "TeamLeaderName",
            message: `No employee found for "${teamLeaderName}"`,
          },
        ]);
      }

      // Resolve client by name / company_name / account owner / linked user
      const clientResult = await client.query(
        `SELECT c.id, c.name, c.company_name, c.email
         FROM clients c
         LEFT JOIN users u ON u.id = c.user_id
         WHERE c.company_id = $1
           AND (
             LOWER(c.name) = LOWER($2)
             OR LOWER(COALESCE(c.company_name, '')) = LOWER($2)
             OR LOWER(COALESCE(c.email, '')) = LOWER($2)
             OR LOWER(COALESCE(c.account_owner_name, '')) = LOWER($2)
             OR LOWER(COALESCE(u.name, '')) = LOWER($2)
           )
         ORDER BY c.id DESC LIMIT 1`,
        [req.company.id, clientName],
      );
      const linkedClient = clientResult.rows[0];
      if (!linkedClient) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "clientName not found in your company", [
          { field: "clientName", message: `No client found for "${clientName}"` },
        ]);
      }

      // Attach leader to team. Never demote a company/super_admin account.
      if (leader.role === "company" || leader.role === "super_admin") {
        // Keep company admin role; only set as project leader + team leader_id
        await client.query(
          `UPDATE teams SET leader_id = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [leader.id, team.id, req.company.id],
        );
      } else {
        await client.query(
          `UPDATE users
           SET role = 'team_leader', team_id = $1
           WHERE id = $2 AND company_id = $3`,
          [team.id, leader.id, req.company.id],
        );
        await client.query(
          `UPDATE teams SET leader_id = $1, updated_at = NOW()
           WHERE id = $2 AND company_id = $3`,
          [leader.id, team.id, req.company.id],
        );
      }

      const { rows } = await client.query(
        `
        INSERT INTO projects (
          company_id, name, description, client_id, team_id, project_leader_id,
          status, priority, start_date, due_date, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,NOW())
        RETURNING *
        `,
        [
          req.company.id,
          projectName,
          description,
          linkedClient.id,
          team.id,
          leader.id,
          projectStatus,
          projectPriority,
          projectDate,
        ],
      );

      await client.query("COMMIT");

      return res.status(201).json({
        success: true,
        code: 201,
        message: "Project created successfully",
        data: {
          id: rows[0].id,
          projectName: rows[0].name,
          description: rows[0].description,
          ProjectStatus: rows[0].status,
          ProjectPriority: rows[0].priority,
          date: rows[0].due_date,
          TeamLeaderName: leader.name,
          teamLeaderId: leader.id,
          ProjectTeam: team.name,
          teamId: team.id,
          clientName: linkedClient.company_name || linkedClient.name,
          clientId: linkedClient.id,
          companyId: rows[0].company_id,
          createdAt: rows[0].created_at,
        },
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        /* ignore */
      }
      next(error);
    } finally {
      client.release();
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
        p.name AS "projectName",
        p.description,
        p.status AS "ProjectStatus",
        p.priority AS "ProjectPriority",
        p.client_id,
        p.team_id,
        p.project_leader_id,
        p.start_date,
        p.due_date AS date,
        p.end_date,
        p.created_at,
        t.name AS "ProjectTeam",
        u.name AS "TeamLeaderName",
        cl.name AS "clientName",
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
// GET / UPDATE / DELETE SINGLE PROJECT
// Supported URLs:
//   GET|PUT|PATCH|DELETE /api/company/projects/17
//   GET|PUT|PATCH|DELETE /api/company/projects/projectId/17
//   GET|PUT|PATCH|DELETE /api/company/projects/projectId:17
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

async function deleteProjectHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) {
      return res.status(400).json({
        success: false,
        code: 400,
        message:
          "Invalid project id. Use /projects/projectId:2 or /projects/projectId/2",
      });
    }

    const existing = await db.query(
      `SELECT id, name, company_id, status, description
       FROM projects
       WHERE id = $1 AND company_id = $2`,
      [projectId, req.company.id],
    );

    if (!existing.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: "Project not found for your company",
      });
    }

    await db.query("BEGIN");

    // Clean related rows that may not cascade automatically
    try {
      await db.query("SAVEPOINT sp_progress");
      await db.query(`DELETE FROM progress_reports WHERE project_id = $1`, [
        projectId,
      ]);
      await db.query("RELEASE SAVEPOINT sp_progress");
    } catch (_) {
      await db.query("ROLLBACK TO SAVEPOINT sp_progress");
    }

    const deleted = await db.query(
      `DELETE FROM projects
       WHERE id = $1 AND company_id = $2
       RETURNING id, name, company_id, status, description`,
      [projectId, req.company.id],
    );

    await db.query("COMMIT");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project deleted successfully",
      data: {
        id: deleted.rows[0].id,
        projectName: deleted.rows[0].name,
        description: deleted.rows[0].description,
        ProjectStatus: deleted.rows[0].status,
        companyId: deleted.rows[0].company_id,
      },
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    db.release();
  }
}

const PROJECT_ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

// Explicit style: /api/company/projects/projectId/17
router.get("/projectId/:projectId", getProjectHandler);
router.put(
  "/projectId/:projectId",
  authorizeRole("company", "super_admin", "team_leader"),
  updateProjectHandler,
);
router.patch(
  "/projectId/:projectId",
  authorizeRole("company", "super_admin", "team_leader"),
  updateProjectHandler,
);
router.delete(
  "/projectId/:projectId",
  authorizeRole("company", "super_admin"),
  deleteProjectHandler,
);
router.all(
  "/projectId/:projectId",
  methodNotAllowed(PROJECT_ITEM_METHODS),
);

// Short / colon style:
// /api/company/projects/17
// /api/company/projects/projectId:2
router.get("/:projectId", getProjectHandler);
router.put(
  "/:projectId",
  authorizeRole("company", "super_admin", "team_leader"),
  updateProjectHandler,
);
router.patch(
  "/:projectId",
  authorizeRole("company", "super_admin", "team_leader"),
  updateProjectHandler,
);
router.delete(
  "/:projectId",
  authorizeRole("company", "super_admin"),
  deleteProjectHandler,
);

// =====================================================
// PROJECT TASKS CRUD
// /api/company/projects/15/tasks
// /api/company/projects/projectId/15/tasks
// /api/company/projects/15/tasks/12
// =====================================================
const taskRouteHandlers = require("../tasks/task.routes").handlers;
const TASK_COLLECTION_METHODS = ["GET", "POST"];
const TASK_ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

const withParsedProjectId = (handler) => (req, res, next) => {
  const projectId = parseProjectId(req.params.projectId);
  if (!projectId) {
    return sendError(res, 400, "Invalid project id", [
      {
        field: "projectId",
        message: "Use /projects/15/tasks or /projects/projectId/15/tasks",
      },
    ]);
  }
  req.params.projectId = String(projectId);
  return handler(req, res, next, projectId);
};

const getProjectTasksHandler = withParsedProjectId((req, res, next, projectId) =>
  taskRouteHandlers.listTasksForProject(req, res, next, projectId),
);

const createProjectTaskHandler = withParsedProjectId((req, res, next, projectId) =>
  taskRouteHandlers.createTaskForProject(req, res, next, projectId),
);

const getOneProjectTaskHandler = withParsedProjectId(async (req, res, next, projectId) => {
  try {
    const taskId = taskRouteHandlers.parseId(req.params.taskId, "taskId");
    if (!taskId) {
      return sendError(res, 400, "Invalid task id");
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.project_id, t.assignee_id, t.created_at,
              u.name AS assignee_name, u.email AS assignee_email
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1 AND t.project_id = $2 AND t.company_id = $3`,
      [taskId, projectId, req.company.id],
    );

    if (!rows[0]) {
      return sendError(res, 404, "Task not found for this project");
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Task fetched successfully",
      projectId,
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

const updateProjectTaskHandler = withParsedProjectId((req, res, next) =>
  taskRouteHandlers.updateTaskHandler(req, res, next),
);

const deleteProjectTaskHandler = withParsedProjectId((req, res, next) =>
  taskRouteHandlers.deleteTaskHandler(req, res, next),
);

const canManageProjectTasks = authorizeRole(
  "company",
  "super_admin",
  "team_leader",
);

// =====================================================
// GET CLIENT FOR A SPECIFIC PROJECT
// GET /api/company/projects/15/client
// GET /api/company/projects/projectId/15/client
// =====================================================
async function getProjectClientHandler(req, res, next) {
  try {
    const projectId = parseProjectId(req.params.projectId);
    if (!projectId) {
      return sendError(res, 400, "Invalid project id", [
        {
          field: "projectId",
          message: "Use /projects/15/client or /projects/projectId/15/client",
        },
      ]);
    }

    const project = await pool.query(
      `SELECT id, name, client_id, status
       FROM projects
       WHERE id = $1 AND company_id = $2`,
      [projectId, req.company.id],
    );

    if (!project.rows[0]) {
      return sendError(res, 404, "Project not found");
    }

    if (!project.rows[0].client_id) {
      return sendError(res, 404, "No client assigned to this project", [
        {
          field: "client_id",
          message: "This project does not have a linked client",
        },
      ]);
    }

    const client = await pool.query(
      `
      SELECT
        c.id,
        c.company_id,
        c.user_id,
        c.name,
        c.email,
        c.company_name AS "companyName",
        c.address,
        c.industry,
        c.account_owner_name AS "AccountOwnerName",
        c.company_size AS "companySize",
        c.revenue AS revenu,
        c.location,
        c.phone,
        c.notes,
        c.created_at,
        c.updated_at
      FROM clients c
      WHERE c.id = $1 AND c.company_id = $2
      `,
      [project.rows[0].client_id, req.company.id],
    );

    if (!client.rows[0]) {
      return sendError(res, 404, "Client not found for this project");
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project client fetched successfully",
      projectId,
      project: {
        id: project.rows[0].id,
        name: project.rows[0].name,
        status: project.rows[0].status,
      },
      data: client.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

router.get("/projectId/:projectId/client", getProjectClientHandler);
router.all("/projectId/:projectId/client", methodNotAllowed(["GET"]));

router.get("/:projectId/client", getProjectClientHandler);
router.all("/:projectId/client", methodNotAllowed(["GET"]));

// Collection: list + create
router.get("/projectId/:projectId/tasks", getProjectTasksHandler);
router.post(
  "/projectId/:projectId/tasks",
  canManageProjectTasks,
  createProjectTaskHandler,
);
router.all(
  "/projectId/:projectId/tasks",
  methodNotAllowed(TASK_COLLECTION_METHODS),
);

router.get("/:projectId/tasks", getProjectTasksHandler);
router.post("/:projectId/tasks", canManageProjectTasks, createProjectTaskHandler);
router.all("/:projectId/tasks", methodNotAllowed(TASK_COLLECTION_METHODS));

// Item: get + edit + delete
router.get("/projectId/:projectId/tasks/:taskId", getOneProjectTaskHandler);
router.put(
  "/projectId/:projectId/tasks/:taskId",
  canManageProjectTasks,
  updateProjectTaskHandler,
);
router.patch(
  "/projectId/:projectId/tasks/:taskId",
  canManageProjectTasks,
  updateProjectTaskHandler,
);
router.delete(
  "/projectId/:projectId/tasks/:taskId",
  canManageProjectTasks,
  deleteProjectTaskHandler,
);
router.all(
  "/projectId/:projectId/tasks/:taskId",
  methodNotAllowed(TASK_ITEM_METHODS),
);

router.get("/:projectId/tasks/:taskId", getOneProjectTaskHandler);
router.put(
  "/:projectId/tasks/:taskId",
  canManageProjectTasks,
  updateProjectTaskHandler,
);
router.patch(
  "/:projectId/tasks/:taskId",
  canManageProjectTasks,
  updateProjectTaskHandler,
);
router.delete(
  "/:projectId/tasks/:taskId",
  canManageProjectTasks,
  deleteProjectTaskHandler,
);
router.all("/:projectId/tasks/:taskId", methodNotAllowed(TASK_ITEM_METHODS));

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
router.all("/:projectId", methodNotAllowed(PROJECT_ITEM_METHODS));

module.exports = router;