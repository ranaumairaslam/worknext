const pool = require("../../config/db");

const positiveInteger = (value, fallback = 0, maximum = 1000000000) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const getPagination = (query) => {
  const page = positiveInteger(query.page, 1, 1000);
  const limit = positiveInteger(query.limit, 10, 100);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

const getLeaderTeam = async (userId) => {
  const userQuery = await pool.query(
    `SELECT id, team_id, company_id, role FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );

  const user = userQuery.rows[0];
  if (!user) return null;

  const teamId = user.team_id || null;

  if (teamId) {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.company_id, t.leader_id, c.name AS company_name
       FROM teams t
       LEFT JOIN companies c ON c.id = t.company_id
       WHERE t.id = $1
       LIMIT 1`,
      [teamId]
    );

    if (rows[0]) return rows[0];
  }

  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.company_id, t.leader_id, c.name AS company_name
     FROM teams t
     LEFT JOIN companies c ON c.id = t.company_id
     WHERE t.leader_id = $1
     LIMIT 1`,
    [userId]
  );

  return rows[0] || null;
};

const getProjects = async (teamId) => {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.status, p.start_date, p.due_date, p.created_at,
            COUNT(t.id)::int AS task_count
     FROM projects p
     LEFT JOIN tasks t ON t.project_id = p.id
     WHERE p.team_id = $1
     GROUP BY p.id, p.name, p.status, p.start_date, p.due_date, p.created_at
     ORDER BY p.created_at DESC`,
    [teamId]
  );

  return rows;
};

const getMembers = async (teamId) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, status, created_at
     FROM users
     WHERE team_id = $1
     ORDER BY name ASC`,
    [teamId]
  );

  return rows;
};

const getTaskSummary = async (teamId) => {
  const { rows } = await pool.query(
    `SELECT
      COUNT(*)::int AS total_tasks,
      COUNT(*) FILTER (WHERE t.status = 'done')::int AS completed_tasks,
      COUNT(*) FILTER (WHERE t.status IN ('todo', 'blocked'))::int AS pending_tasks,
      COUNT(*) FILTER (WHERE t.status IN ('in_progress', 'submitted', 'under_review'))::int AS in_progress_tasks
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE p.team_id = $1;`,
    [teamId]
  );

  return rows[0] || {
    total_tasks: 0,
    completed_tasks: 0,
    pending_tasks: 0,
    in_progress_tasks: 0,
  };
};

const getRecentTasks = async (teamId, limit = 5) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.created_at,
            p.id AS project_id, p.name AS project_name,
            u.name AS assignee_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE p.team_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2`,
    [teamId, limit]
  );

  return rows;
};

const getUserCompanyId = async (userId) => {
  const { rows } = await pool.query(
    `SELECT company_id FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );

  return rows[0]?.company_id || null;
};

exports.addEmployeeToTeam = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const { userId, role = "team_member" } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const { rowCount } = await pool.query(
      `UPDATE users
       SET team_id = $1, role = $2
       WHERE id = $3 AND company_id = $4`,
      [team.id, role, userId, team.company_id]
    );

    if (!rowCount) {
      return res.status(404).json({ success: false, message: "User not found in your company" });
    }

    return res.status(200).json({
      success: true,
      message: "Employee assigned to team",
      data: { userId, role, teamId: team.id },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateTaskPriority = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const taskId = positiveInteger(req.params.taskId, 0);
    const { priority } = req.body;

    if (!taskId) {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE tasks t
       SET priority = COALESCE(NULLIF($1, ''), priority)
       FROM projects p
       WHERE t.id = $2 AND p.id = t.project_id AND p.team_id = $3
       RETURNING t.id, t.priority`,
      [priority, taskId, team.id]
    );

    if (!rowCount) {
      return res.status(404).json({ success: false, message: "Task not found in your team" });
    }

    return res.status(200).json({
      success: true,
      message: "Task priority updated",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.getDashboard = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team assigned to this Team Leader",
      });
    }

    const [projects, members, tasks, recentTasks] = await Promise.all([
      getProjects(team.id),
      getMembers(team.id),
      getTaskSummary(team.id),
      getRecentTasks(team.id),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        team,
        stats: {
          totalProjects: projects.length,
          totalMembers: members.length,
          ...tasks,
        },
        projects,
        members,
        recentTasks,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.viewAssignedProjects = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const projects = await getProjects(team.id);

    return res.json({ success: true, data: projects });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.viewTeamMembers = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const members = await getMembers(team.id);

    return res.json({ success: true, data: members });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.createTask = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const {
      title,
      description,
      projectId,
      assigneeId,
      dueDate,
      priority = "medium",
    } = req.body;

    // Task Name
    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "Task name is required",
      });
    }

    // Project
    if (!projectId) {
      return res.status(400).json({
        success: false,
        message: "Project is required",
      });
    }

    // Check project belongs to leader's team
    const project = await pool.query(
      `
      SELECT id
      FROM projects
      WHERE id = $1
        AND team_id = $2
      LIMIT 1
      `,
      [projectId, team.id]
    );

    if (!project.rowCount) {
      return res.status(404).json({
        success: false,
        message: "Project not found in your team",
      });
    }

    // Get company
    let companyId = await getUserCompanyId(req.user.id);

    if (!companyId) {
      companyId = team.company_id;
    }

    // Team member is optional
    let validAssigneeId = null;

    if (assigneeId) {
      const assignee = await pool.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND team_id = $2
          AND company_id = $3
        LIMIT 1
        `,
        [assigneeId, team.id, companyId]
      );

      if (!assignee.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Team member not found in your team",
        });
      }

      validAssigneeId = assigneeId;
    }

    // Validate priority
    const normalizedPriority = String(priority).toLowerCase();

    if (!["high", "medium", "low"].includes(normalizedPriority)) {
      return res.status(400).json({
        success: false,
        message: "Priority must be high, medium, or low",
      });
    }

    // Create task
    const { rows } = await pool.query(
      `
      INSERT INTO tasks (
        title,
        description,
        project_id,
        company_id,
        assignee_id,
        status,
        priority,
        due_date
      )
      VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7)
      RETURNING
        id,
        title,
        description,
        project_id,
        company_id,
        assignee_id,
        status,
        priority,
        due_date,
        created_at
      `,
      [
        String(title).trim(),
        description?.trim() || null,
        projectId,
        companyId,
        validAssigneeId,
        normalizedPriority,
        dueDate || null,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error("Create Task Error:", err);

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

exports.assignTask = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const taskId = positiveInteger(req.params.taskId, 0);
    const { assignedTo } = req.body;

    if (!taskId) {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const taskCheck = await pool.query(
      `SELECT t.id
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1 AND p.team_id = $2`,
      [taskId, team.id]
    );

    if (!taskCheck.rowCount) {
      return res.status(404).json({ success: false, message: "Task not found in your team" });
    }

    const assignee = await pool.query(
      `SELECT id FROM users WHERE id = $1 AND team_id = $2 AND company_id = $3 LIMIT 1`,
      [assignedTo, team.id, team.company_id]
    );

    if (!assignee.rowCount) {
      return res.status(404).json({ success: false, message: "Assignee not found in your team" });
    }

    const { rows } = await pool.query(
      `UPDATE tasks
       SET assignee_id = $1
       WHERE id = $2
       RETURNING id, assignee_id, status`,
      [assignedTo, taskId]
    );

    return res.json({
      success: true,
      message: "Task assigned successfully",
      data: rows[0],
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.viewTasks = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const { page, limit, offset } = getPagination(req.query);
    const search = String(req.query.search || "").trim();
    const allowedStatuses = ["todo", "in_progress", "under_review", "submitted", "done", "blocked"];
    const status = allowedStatuses.includes(req.query.status)
      ? req.query.status
      : null;
    const assigneeId = positiveInteger(req.query.assigneeId, 0);
    const projectId = positiveInteger(req.query.projectId, 0);

    const where = ["p.team_id = $1"];
    const values = [team.id];

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
    if (projectId) {
      values.push(projectId);
      where.push(`p.id = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;
    const tasksQuery = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id, t.created_at,
              p.id AS project_id, p.name AS project_name, u.name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       ${whereClause}
       ORDER BY t.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const countQuery = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       ${whereClause}`,
      values
    );

    return res.json({
      success: true,
      data: tasksQuery.rows,
      pagination: { page, limit, total: countQuery.rows[0].total },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.reviewSubmittedTasks = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.assignee_id, t.created_at,
              p.id AS project_id, p.name AS project_name, u.name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE p.team_id = $1 AND t.status IN ('submitted', 'under_review')
       ORDER BY t.created_at DESC`,
      [team.id]
    );

    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.approveTask = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const taskId = positiveInteger(req.params.taskId, 0);
    if (!taskId) {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE tasks t
       SET status = 'done'
       FROM projects p
       WHERE t.id = $1 AND p.id = t.project_id AND p.team_id = $2
       RETURNING t.id, t.status`,
      [taskId, team.id]
    );

    if (!rowCount) {
      return res.status(404).json({ success: false, message: "Task not found in your team" });
    }

    return res.json({ success: true, message: "Task approved", data: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.returnTaskForRevision = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const taskId = positiveInteger(req.params.taskId, 0);
    const reviewNote = String(req.body.reviewNote || "").trim();

    if (!taskId) {
      return res.status(400).json({ success: false, message: "Invalid task id" });
    }

    const { rows, rowCount } = await pool.query(
      `UPDATE tasks t
       SET status = 'todo'
       FROM projects p
       WHERE t.id = $1 AND p.id = t.project_id AND p.team_id = $2
       RETURNING t.id, t.status`,
      [taskId, team.id]
    );

    if (!rowCount) {
      return res.status(404).json({ success: false, message: "Task not found in your team" });
    }

    return res.json({
      success: true,
      message: "Task returned for revision",
      data: { taskId, reviewNote, status: rows[0].status },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.monitorTeamProgress = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const { rows } = await pool.query(
      `SELECT
        COUNT(*)::int AS total_tasks,
        COUNT(*) FILTER (WHERE t.status='done')::int AS completed_tasks,
        COUNT(*) FILTER (WHERE t.status IN ('in_progress', 'submitted', 'under_review'))::int AS in_progress_tasks,
        COUNT(*) FILTER (WHERE t.status='blocked')::int AS blocked_tasks,
        COUNT(*) FILTER (WHERE t.status IN ('todo', 'blocked'))::int AS pending_tasks
      FROM tasks t
      JOIN projects p ON p.id=t.project_id
      WHERE p.team_id=$1;`,
      [team.id]
    );

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
/*
|--------------------------------------------------------------------------
| TEAM PERFORMANCE
|--------------------------------------------------------------------------
| GET /api/team-leader/team-performance
|--------------------------------------------------------------------------
*/

exports.getTeamPerformance = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.email,
        u.role,
        u.status,

        COUNT(t.id)::int AS total_tasks,

        COUNT(t.id) FILTER (
          WHERE t.status = 'done'
        )::int AS completed_tasks,

        COUNT(t.id) FILTER (
          WHERE t.status IN ('todo', 'blocked')
        )::int AS pending_tasks,

        COUNT(t.id) FILTER (
          WHERE t.status IN (
            'in_progress',
            'submitted',
            'under_review'
          )
        )::int AS in_progress_tasks,

        COUNT(t.id) FILTER (
          WHERE t.status = 'blocked'
        )::int AS blocked_tasks

      FROM users u

      LEFT JOIN tasks t
        ON t.assignee_id = u.id

      WHERE u.team_id = $1

      GROUP BY
        u.id,
        u.name,
        u.email,
        u.role,
        u.status

      ORDER BY u.name ASC
      `,
      [team.id]
    );

    const performance = rows.map((member) => {
      const total = Number(member.total_tasks) || 0;
      const completed = Number(member.completed_tasks) || 0;

      const progress =
        total > 0
          ? Math.round((completed / total) * 100)
          : 0;

      return {
        user_id: member.user_id,
        name: member.name,
        email: member.email,
        role: member.role,
        status: member.status,

        total_tasks: total,
        completed_tasks: completed,
        pending_tasks: Number(member.pending_tasks) || 0,
        in_progress_tasks:
          Number(member.in_progress_tasks) || 0,
        blocked_tasks:
          Number(member.blocked_tasks) || 0,

        progress,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        team: {
          id: team.id,
          name: team.name,
        },
        members: performance,
      },
    });

  } catch (error) {
    console.error("❌ getTeamPerformance:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load team performance",
    });
  }
};

exports.generateTeamReport = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: "No team found" });
    }

    const { from, to } = req.query;
    const { rows } = await pool.query(
      `SELECT

COUNT(*)::int AS total_tasks,

COUNT(*) FILTER (
    WHERE t.status='done'
)::int AS completed_tasks,

COUNT(*) FILTER (
    WHERE t.status='todo'
)::int AS pending_tasks,

COUNT(*) FILTER (
    WHERE t.created_at >= COALESCE($2::timestamptz,t.created_at)
)::int AS created_after_from

FROM tasks t
JOIN projects p
ON p.id=t.project_id

WHERE p.team_id=$1;`,
      [team.id, from || null]
    );

    return res.json({
      success: true,
      data: {
        team: team.name,
        from: from || null,
        to: to || null,
        summary: rows[0],
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};
