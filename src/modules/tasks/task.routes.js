const express = require("express");
const pool = require("../../config/db");

const router = express.Router({ mergeParams: true });

const allowedTaskStatuses = ["todo", "in_progress", "done", "blocked"];
const allowedTaskPriorities = ["low", "medium", "high"];

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const parseId = (raw, prefix) => {
  const value = String(raw || "").trim();
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = value.match(new RegExp(`^(?:${escaped}[:/])?(\\d+)$`, "i"));
  if (!matched) return null;
  const id = Number.parseInt(matched[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: "You do not have access to this resource",
      });
    }
    next();
  };

const methodNotAllowed = (allowed) => (req, res) => {
  res.set("Allow", allowed.join(", "));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(", ")}`,
  });
};

const sendError = (res, status, message, errors = null) => {
  const payload = { success: false, code: status, message };
  if (errors) payload.errors = errors;
  return res.status(status).json(payload);
};

const canManageTasks = authorizeRole("company", "team_leader", "super_admin");

async function ensureProjectInCompany(projectId, companyId) {
  const { rows } = await pool.query(
    `SELECT id, name, status FROM projects WHERE id = $1 AND company_id = $2`,
    [projectId, companyId],
  );
  return rows[0] || null;
}

async function resolveAssigneeId(companyId, body = {}) {
  const rawId = body.assigneeId ?? body.AssigneeId ?? null;
  if (rawId !== null && rawId !== undefined && String(rawId).trim() !== "") {
    const id = parseId(rawId, "assigneeId");
    if (!id) return { error: "Invalid assigneeId" };
    const assignee = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!assignee.rows[0]) return { error: "Assignee not found in this company" };
    return { assigneeId: id };
  }

  const name = String(
    body.EmployeeName || body.assigneeName || body.AssigneeName || "",
  ).trim();
  if (!name) return { assigneeId: null };

  const assignee = await pool.query(
    `SELECT id FROM users
     WHERE company_id = $1 AND LOWER(name) = LOWER($2)
     LIMIT 1`,
    [companyId, name],
  );
  if (!assignee.rows[0]) {
    return { error: `Employee "${name}" not found in this company` };
  }
  return { assigneeId: assignee.rows[0].id };
}

function pickTaskFields(body = {}) {
  return {
    title: body.TaskName ?? body.taskName ?? body.title ?? null,
    description: body.description ?? body.Description ?? null,
    dueDate: body.dueDate ?? body.DueDate ?? body.date ?? null,
    priority: body.priority ?? body.Priority ?? "medium",
    status: body.status ?? body.Status ?? null,
  };
}

async function listTasksForProject(req, res, next, projectId) {
  try {
    if (!projectId) {
      return sendError(res, 400, "Invalid project id", [
        {
          field: "projectId",
          message: "Use /tasks/projectId/15 or ?projectId=15",
        },
      ]);
    }

    const project = await ensureProjectInCompany(projectId, req.company.id);
    if (!project) return sendError(res, 404, "Project not found");

    const status = allowedTaskStatuses.includes(req.query.status)
      ? req.query.status
      : null;

    const values = [projectId, req.company.id];
    let statusClause = "";
    if (status) {
      values.push(status);
      statusClause = ` AND t.status = $${values.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.project_id,
        t.assignee_id,
        t.created_at,
        u.name AS assignee_name,
        u.email AS assignee_email
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.project_id = $1
        AND t.company_id = $2
        ${statusClause}
      ORDER BY t.created_at DESC
      `,
      values,
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Tasks fetched successfully",
      count: rows.length,
      projectId,
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
}

async function createTaskForProject(req, res, next, projectId) {
  try {
    if (!projectId) {
      return sendError(res, 400, "Invalid project id");
    }

    const project = await ensureProjectInCompany(projectId, req.company.id);
    if (!project) {
      return sendError(res, 404, "Project not found in this company");
    }

    const { title, description, dueDate, priority } = pickTaskFields(req.body);
    if (!title || !String(title).trim()) {
      return sendError(res, 400, "Task title is required", [
        { field: "TaskName", message: "TaskName or title is required" },
      ]);
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return sendError(res, 400, "Invalid task priority", [
        {
          field: "priority",
          message: `Allowed: ${allowedTaskPriorities.join(", ")}`,
        },
      ]);
    }

    const assignee = await resolveAssigneeId(req.company.id, req.body || {});
    if (assignee.error) return sendError(res, 404, assignee.error);

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, project_id, company_id, assignee_id, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7)
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at`,
      [
        String(title).trim(),
        description || null,
        projectId,
        req.company.id,
        assignee.assigneeId,
        priority || "medium",
        dueDate || null,
      ],
    );

    return res.status(201).json({
      success: true,
      code: 201,
      message: "Task created successfully",
      projectId,
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

async function updateTaskHandler(req, res, next) {
  try {
    const taskId = parseId(req.params.taskId, "taskId");
    if (!taskId) return sendError(res, 400, "Invalid task id");

    const { title, description, dueDate, priority, status } = pickTaskFields(
      req.body,
    );
    if (status && !allowedTaskStatuses.includes(status)) {
      return sendError(res, 400, "Invalid task status", [
        {
          field: "status",
          message: `Allowed: ${allowedTaskStatuses.join(", ")}`,
        },
      ]);
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return sendError(res, 400, "Invalid task priority", [
        {
          field: "priority",
          message: `Allowed: ${allowedTaskPriorities.join(", ")}`,
        },
      ]);
    }

    const body = req.body || {};
    const hasAssigneeField =
      body.assigneeId !== undefined ||
      body.AssigneeId !== undefined ||
      body.EmployeeName !== undefined ||
      body.assigneeName !== undefined ||
      body.AssigneeName !== undefined;

    let assigneeId = undefined;
    if (hasAssigneeField) {
      const assignee = await resolveAssigneeId(req.company.id, body);
      if (assignee.error) return sendError(res, 404, assignee.error);
      assigneeId = assignee.assigneeId;
    }

    // Optional: keep task inside a specific project when nested
    const scopedProjectId = req.params.projectId
      ? parseId(req.params.projectId, "projectId")
      : null;

    const values = [
      title !== null && title !== undefined ? String(title).trim() : null,
      description,
      hasAssigneeField,
      hasAssigneeField ? assigneeId : null,
      dueDate || null,
      priority || null,
      status || null,
      taskId,
      req.company.id,
    ];

    let projectClause = "";
    if (scopedProjectId) {
      values.push(scopedProjectId);
      projectClause = ` AND project_id = $${values.length}`;
    }

    const { rows } = await pool.query(
      `UPDATE tasks SET
         title = COALESCE(NULLIF($1, ''), title),
         description = COALESCE($2, description),
         assignee_id = CASE WHEN $3::boolean THEN $4 ELSE assignee_id END,
         due_date = COALESCE($5, due_date),
         priority = COALESCE(NULLIF($6, ''), priority),
         status = COALESCE(NULLIF($7, ''), status),
         updated_at = NOW()
       WHERE id = $8 AND company_id = $9
       ${projectClause}
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at, updated_at`,
      values,
    );

    if (!rows[0]) {
      return sendError(
        res,
        404,
        scopedProjectId
          ? "Task not found for this project"
          : "Task not found",
      );
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Task updated successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

async function deleteTaskHandler(req, res, next) {
  try {
    const taskId = parseId(req.params.taskId, "taskId");
    if (!taskId) return sendError(res, 400, "Invalid task id");

    const scopedProjectId = req.params.projectId
      ? parseId(req.params.projectId, "projectId")
      : null;

    const values = [taskId, req.company.id];
    let projectClause = "";
    if (scopedProjectId) {
      values.push(scopedProjectId);
      projectClause = ` AND project_id = $${values.length}`;
    }

    const { rows } = await pool.query(
      `DELETE FROM tasks
       WHERE id = $1 AND company_id = $2
       ${projectClause}
       RETURNING id, title, project_id`,
      values,
    );

    if (!rows[0]) {
      return sendError(
        res,
        404,
        scopedProjectId
          ? "Task not found for this project"
          : "Task not found",
      );
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Task deleted successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

// =====================================================
// Project-scoped tasks
// GET/POST /api/company/tasks/projectId/15
// GET/POST /api/company/tasks/projectId:15
// =====================================================
router.get("/projectId/:projectId", async (req, res, next) => {
  const projectId = parseId(req.params.projectId, "projectId");
  return listTasksForProject(req, res, next, projectId);
});

router.post("/projectId/:projectId", canManageTasks, async (req, res, next) => {
  const projectId = parseId(req.params.projectId, "projectId");
  return createTaskForProject(req, res, next, projectId);
});

router.all("/projectId/:projectId", methodNotAllowed(["GET", "POST"]));

// =====================================================
// Collection: list / create
// =====================================================
router.get("/", async (req, res, next) => {
  try {
    if (req.query.projectId !== undefined && req.query.projectId !== "") {
      const projectId = parseId(req.query.projectId, "projectId");
      return listTasksForProject(req, res, next, projectId);
    }

    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const status = allowedTaskStatuses.includes(req.query.status)
      ? req.query.status
      : null;
    const assigneeId = positiveInteger(req.query.assigneeId, 0, 1000000000);

    const where = ["t.company_id = $1"];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`t.title ILIKE $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`t.status = $${values.length}`);
    }
    if (assigneeId) {
      values.push(assigneeId);
      where.push(`t.assignee_id = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const tasks = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.project_id, t.assignee_id, t.created_at,
              p.name AS project_name,
              u.name AS assignee_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tasks t ${whereClause}`,
      values,
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Tasks fetched successfully",
      count: tasks.rows.length,
      pagination: { page, limit, total: count.rows[0].total },
      data: tasks.rows,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", canManageTasks, async (req, res, next) => {
  const body = req.body || {};
  const projectId = parseId(
    body.projectId ?? body.ProjectId ?? body.project_id,
    "projectId",
  );
  if (!projectId) {
    return sendError(res, 400, "Project ID is required", [
      { field: "projectId", message: "projectId is required in body" },
    ]);
  }
  return createTaskForProject(req, res, next, projectId);
});

router.all("/", methodNotAllowed(["GET", "POST"]));

// =====================================================
// Single task: get / edit / delete
// Also supports GET /tasks/projectId:15 (list by project)
// =====================================================
router.get("/:taskId", async (req, res, next) => {
  const raw = String(req.params.taskId || "");

  if (/^projectId[:/]/i.test(raw)) {
    const projectId = parseId(raw, "projectId");
    return listTasksForProject(req, res, next, projectId);
  }

  const taskId = parseId(raw, "taskId");
  if (!taskId) {
    return sendError(res, 400, "Invalid id", [
      {
        field: "id",
        message:
          "Use /tasks/projectId:15 for project tasks, or /tasks/12 for a task",
      },
    ]);
  }

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.project_id, p.name AS project_name,
              t.assignee_id, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [taskId, req.company.id],
    );

    if (!rows[0]) return sendError(res, 404, "Task not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Task fetched successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/projectId:15 — create task for that project
router.post("/:projectId", canManageTasks, async (req, res, next) => {
  const raw = String(req.params.projectId || "");
  if (!/^projectId[:/]/i.test(raw)) {
    return sendError(res, 405, "Method POST not allowed on task id. Use PUT/PATCH/DELETE");
  }
  const projectId = parseId(raw, "projectId");
  return createTaskForProject(req, res, next, projectId);
});

router.put("/:taskId", canManageTasks, updateTaskHandler);
router.patch("/:taskId", canManageTasks, updateTaskHandler);
router.delete("/:taskId", canManageTasks, deleteTaskHandler);

router.patch(
  "/:taskId/status",
  canManageTasks,
  async (req, res, next) => {
    try {
      const taskId = parseId(req.params.taskId, "taskId");
      const { status } = req.body || {};
      if (!taskId) return sendError(res, 400, "Invalid task id");
      if (!allowedTaskStatuses.includes(status)) {
        return sendError(res, 400, "Invalid task status");
      }

      const { rows } = await pool.query(
        `UPDATE tasks
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3
         RETURNING id, title, status, priority, due_date, assignee_id, project_id`,
        [status, taskId, req.company.id],
      );

      if (!rows[0]) return sendError(res, 404, "Task not found");

      return res.status(200).json({
        success: true,
        code: 200,
        message: "Task status updated successfully",
        data: rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
);
router.all("/:taskId/status", methodNotAllowed(["PATCH"]));

router.all(
  "/:taskId",
  methodNotAllowed(["GET", "POST", "PUT", "PATCH", "DELETE"]),
);

module.exports = router;
module.exports.handlers = {
  listTasksForProject,
  createTaskForProject,
  updateTaskHandler,
  deleteTaskHandler,
  parseId,
  canManageTasks,
  methodNotAllowed,
  sendError,
};
