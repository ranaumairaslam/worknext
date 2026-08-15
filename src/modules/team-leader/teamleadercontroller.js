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

const pickValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const normalizePriority = (raw) => {
  const value = String(raw || 'medium').trim().toLowerCase();
  const aliases = {
    high: 'high',
    medium: 'medium',
    low: 'low',
  };
  return aliases[value] || value;
};

const parseDueDate = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
};

const isDateBeforeToday = (date) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = new Date(date);
  due.setHours(0, 0, 0, 0);

  return due < today;
};

const getTeamByNameForLeader = async (userId, companyId, teamName) => {
  const { rows } = await pool.query(
    `SELECT t.id, t.name, t.company_id, t.leader_id
     FROM teams t
     WHERE t.company_id = $1
       AND LOWER(TRIM(t.name)) = LOWER($2)
       AND (
         t.leader_id = $3
         OR t.id = (SELECT team_id FROM users WHERE id = $3 LIMIT 1)
       )
     LIMIT 1`,
    [companyId, teamName, userId]
  );

  return rows[0] || null;
};

const getTeamMemberByName = async (teamId, companyId, memberName) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, status, team_id
     FROM users
     WHERE team_id = $1
       AND company_id = $2
       AND LOWER(TRIM(name)) = LOWER($3)
       AND role IN ('team_member', 'team_leader')
     LIMIT 1`,
    [teamId, companyId, memberName]
  );

  return rows[0] || null;
};

const mapAssignTaskResponse = (task, team, member, project) => ({
  TaskName: task.title,
  TaskDescription: task.description,
  TeamName: team?.name || null,
  TeamMemberName: member?.name || task.assignee_name || null,
  Priority: task.priority,
  Date: task.due_date,
  taskId: task.id,
  projectId: project?.id || task.project_id || null,
  projectName: project?.name || null,
  status: task.status,
});

const getTaskForLeader = async (userId, companyId, { taskId, taskName }) => {
  const baseQuery = `
    SELECT
      t.id,
      t.title,
      t.description,
      t.project_id,
      t.assignee_id,
      t.status,
      t.priority,
      t.due_date,
      p.team_id,
      tm.name AS team_name,
      u.name AS assignee_name
    FROM tasks t
    JOIN projects p ON p.id = t.project_id
    JOIN teams tm ON tm.id = p.team_id
    LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.company_id = $1
      AND (
        tm.leader_id = $2
        OR tm.id = (SELECT team_id FROM users WHERE id = $2 LIMIT 1)
      )
  `;

  if (taskId) {
    const { rows } = await pool.query(
      `${baseQuery} AND t.id = $3 LIMIT 1`,
      [companyId, userId, taskId]
    );
    return { task: rows[0] || null };
  }

  if (taskName) {
    const { rows } = await pool.query(
      `${baseQuery} AND LOWER(TRIM(t.title)) = LOWER($3)
       ORDER BY t.created_at DESC`,
      [companyId, userId, taskName]
    );

    if (rows.length > 1) {
      return {
        ambiguous: true,
        task: null,
      };
    }

    return { task: rows[0] || null };
  }

  return { task: null };
};

const parseAssignTaskFields = (body, { requireAll = false } = {}) => {
  const errors = {};
  const fields = {
    taskId: positiveInteger(body.taskId ?? body.TaskId ?? body.id, 0),
    taskName: pickValue(body.TaskName, body.taskName, body.title),
    newTaskName: pickValue(body.NewTaskName, body.newTaskName),
    taskDescription: pickValue(
      body.TaskDescription,
      body.taskDescription,
      body.description
    ),
    teamName: pickValue(body.TeamName, body.teamName),
    teamMemberName: pickValue(
      body.TeamMemberName,
      body.teamMemberName,
      body.memberName
    ),
    priorityRaw: pickValue(body.Priority, body.Prority, body.priority),
    dateRaw: pickValue(body.Date, body.date, body.dueDate),
  };

  if (requireAll) {
    if (!fields.taskName) errors.TaskName = 'Task name is required';
    if (!fields.teamName) errors.TeamName = 'Team name is required';
    if (!fields.teamMemberName) {
      errors.TeamMemberName = 'Team member name is required';
    }
    if (!fields.priorityRaw) errors.Priority = 'Priority is required';
    if (!fields.dateRaw) errors.Date = 'Date is required';
  }

  return { fields, errors };
};

const validateAssignDate = (dateRaw) => {
  const dueDate = parseDueDate(dateRaw);
  if (!dueDate) {
    return {
      error: 'Date must be a valid date (YYYY-MM-DD)',
    };
  }

  if (isDateBeforeToday(dueDate)) {
    return {
      error: 'Date cannot be before today',
    };
  }

  return {
    dueDate,
    dueDateValue: dueDate.toISOString().split('T')[0],
  };
};

exports.getTeamMembersByTeamName = async (req, res) => {
  try {
    const leaderTeam = await getLeaderTeam(req.user.id);
    if (!leaderTeam) {
      return res.status(404).json({ success: false, message: 'No team found' });
    }

    const teamName = pickValue(
      req.query.TeamName,
      req.query.teamName,
      req.body?.TeamName,
      req.body?.teamName
    );

    if (!teamName) {
      return res.status(400).json({
        success: false,
        message: 'Team name is required',
        errors: {
          TeamName: 'Team name is required',
        },
      });
    }

    const companyId =
      leaderTeam.company_id || (await getUserCompanyId(req.user.id));

    const team = await getTeamByNameForLeader(
      req.user.id,
      companyId,
      teamName
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or you do not lead this team',
        errors: {
          TeamName: `"${teamName}" was not found in your company`,
        },
      });
    }

    const members = await getMembers(team.id);

    return res.status(200).json({
      success: true,
      data: {
        TeamName: team.name,
        teamId: team.id,
        members: members.map((member) => ({
          TeamMemberName: member.name,
          id: member.id,
          email: member.email,
          role: member.role,
          status: member.status,
        })),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.assignTaskByNames = async (req, res) => {
  try {
    const leaderTeam = await getLeaderTeam(req.user.id);
    if (!leaderTeam) {
      return res.status(404).json({ success: false, message: 'No team found' });
    }

    const { fields, errors } = parseAssignTaskFields(req.body || {}, {
      requireAll: true,
    });

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    const normalizedPriority = normalizePriority(fields.priorityRaw);
    if (!['high', 'medium', 'low'].includes(normalizedPriority)) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: {
          Priority: 'Priority must be high, medium, or low',
        },
      });
    }

    const dateCheck = validateAssignDate(fields.dateRaw);
    if (dateCheck.error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: {
          Date: dateCheck.error,
        },
      });
    }

    const companyId =
      leaderTeam.company_id || (await getUserCompanyId(req.user.id));

    const team = await getTeamByNameForLeader(
      req.user.id,
      companyId,
      fields.teamName
    );

    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found or you do not lead this team',
        errors: {
          TeamName: `"${fields.teamName}" was not found in your company`,
        },
      });
    }

    const member = await getTeamMemberByName(
      team.id,
      companyId,
      fields.teamMemberName
    );

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Team member not found in the selected team',
        errors: {
          TeamMemberName: `"${fields.teamMemberName}" is not a member of "${team.name}"`,
        },
      });
    }

    const projectResult = await pool.query(
      `SELECT id, name
       FROM projects
       WHERE team_id = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [team.id]
    );

    if (!projectResult.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'No project found for this team',
        errors: {
          TeamName: `No project is assigned to team "${team.name}"`,
        },
      });
    }

    const project = projectResult.rows[0];

    const { rows } = await pool.query(
      `INSERT INTO tasks (
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
        created_at`,
      [
        fields.taskName,
        fields.taskDescription || null,
        project.id,
        companyId,
        member.id,
        normalizedPriority,
        dateCheck.dueDateValue,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Task assigned successfully',
      data: mapAssignTaskResponse(rows[0], team, member, project),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.editTaskByNames = async (req, res) => {
  try {
    const leaderTeam = await getLeaderTeam(req.user.id);
    if (!leaderTeam) {
      return res.status(404).json({ success: false, message: 'No team found' });
    }

    const body = req.body || {};
    const { fields, errors } = parseAssignTaskFields(body);
    const lookupName = pickValue(
      body.LookupTaskName,
      body.lookupTaskName,
      body.OriginalTaskName,
      body.originalTaskName
    );

    const taskId = fields.taskId;
    const taskNameForLookup = lookupName || fields.taskName;

    if (!taskId && !taskNameForLookup) {
      errors.taskId = 'taskId or TaskName is required to identify the task';
    }

    const hasUpdate =
      body.NewTaskName !== undefined ||
      body.newTaskName !== undefined ||
      body.TaskDescription !== undefined ||
      body.taskDescription !== undefined ||
      body.description !== undefined ||
      body.TeamName !== undefined ||
      body.teamName !== undefined ||
      body.TeamMemberName !== undefined ||
      body.teamMemberName !== undefined ||
      body.memberName !== undefined ||
      body.Priority !== undefined ||
      body.Prority !== undefined ||
      body.priority !== undefined ||
      body.Date !== undefined ||
      body.date !== undefined ||
      body.dueDate !== undefined ||
      (taskId && (body.TaskName !== undefined || body.taskName !== undefined));

    if (!hasUpdate) {
      errors.body =
        'Provide at least one field to update: TaskName, TaskDescription, TeamName, TeamMemberName, Priority, or Date';
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors,
      });
    }

    const companyId =
      leaderTeam.company_id || (await getUserCompanyId(req.user.id));

    const lookup = await getTaskForLeader(req.user.id, companyId, {
      taskId: taskId || null,
      taskName: taskId ? null : taskNameForLookup,
    });

    if (lookup.ambiguous) {
      return res.status(409).json({
        success: false,
        message: 'Multiple tasks found with this name. Use taskId instead.',
        errors: {
          TaskName: 'Multiple tasks match this name',
        },
      });
    }

    if (!lookup.task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in your team',
        errors: {
          TaskName: 'Task not found',
        },
      });
    }

    const existingTask = lookup.task;

    const taskDescriptionProvided =
      body.TaskDescription !== undefined ||
      body.taskDescription !== undefined ||
      body.description !== undefined;
    const teamNameProvided =
      body.TeamName !== undefined || body.teamName !== undefined;
    const teamMemberProvided =
      body.TeamMemberName !== undefined ||
      body.teamMemberName !== undefined ||
      body.memberName !== undefined;
    const priorityProvided =
      body.Priority !== undefined ||
      body.Prority !== undefined ||
      body.priority !== undefined;
    const dateProvided =
      body.Date !== undefined || body.date !== undefined || body.dueDate !== undefined;
    const renameProvided =
      body.NewTaskName !== undefined ||
      body.newTaskName !== undefined ||
      (taskId &&
        (body.TaskName !== undefined || body.taskName !== undefined));

    let team = {
      id: existingTask.team_id,
      name: existingTask.team_name,
    };
    let member = existingTask.assignee_id
      ? {
          id: existingTask.assignee_id,
          name: existingTask.assignee_name,
        }
      : null;
    let project = {
      id: existingTask.project_id,
      name: null,
    };

    if (teamNameProvided) {
      const resolvedTeam = await getTeamByNameForLeader(
        req.user.id,
        companyId,
        fields.teamName
      );

      if (!resolvedTeam) {
        return res.status(404).json({
          success: false,
          message: 'Team not found or you do not lead this team',
          errors: {
            TeamName: `"${fields.teamName}" was not found in your company`,
          },
        });
      }

      team = resolvedTeam;

      const projectResult = await pool.query(
        `SELECT id, name
         FROM projects
         WHERE team_id = $1
         ORDER BY created_at ASC
         LIMIT 1`,
        [team.id]
      );

      if (!projectResult.rowCount) {
        return res.status(404).json({
          success: false,
          message: 'No project found for this team',
          errors: {
            TeamName: `No project is assigned to team "${team.name}"`,
          },
        });
      }

      project = projectResult.rows[0];
    }

    if (teamMemberProvided) {
      const resolvedMember = await getTeamMemberByName(
        team.id,
        companyId,
        fields.teamMemberName
      );

      if (!resolvedMember) {
        return res.status(404).json({
          success: false,
          message: 'Team member not found in the selected team',
          errors: {
            TeamMemberName: `"${fields.teamMemberName}" is not a member of "${team.name}"`,
          },
        });
      }

      member = resolvedMember;
    }

    let normalizedPriority = existingTask.priority;
    if (priorityProvided) {
      normalizedPriority = normalizePriority(fields.priorityRaw);
      if (!['high', 'medium', 'low'].includes(normalizedPriority)) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: {
            Priority: 'Priority must be high, medium, or low',
          },
        });
      }
    }

    let dueDateValue = existingTask.due_date;
    if (dateProvided) {
      const dateCheck = validateAssignDate(fields.dateRaw);
      if (dateCheck.error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: {
            Date: dateCheck.error,
          },
        });
      }
      dueDateValue = dateCheck.dueDateValue;
    }

    const updatedTitle = renameProvided
      ? fields.newTaskName || fields.taskName
      : existingTask.title;

    const updatedDescription = taskDescriptionProvided
      ? fields.taskDescription || null
      : existingTask.description;

    const { rows } = await pool.query(
      `UPDATE tasks
       SET
         title = $1,
         description = $2,
         project_id = $3,
         assignee_id = $4,
         priority = $5,
         due_date = $6,
         updated_at = NOW()
       WHERE id = $7
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
         created_at`,
      [
        updatedTitle,
        updatedDescription,
        project.id,
        member?.id || null,
        normalizedPriority,
        dueDateValue,
        existingTask.id,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Task updated successfully',
      data: mapAssignTaskResponse(rows[0], team, member, project),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.deleteTaskByNames = async (req, res) => {
  try {
    const leaderTeam = await getLeaderTeam(req.user.id);
    if (!leaderTeam) {
      return res.status(404).json({ success: false, message: 'No team found' });
    }

    const body = { ...req.body, ...req.query };
    const taskId = positiveInteger(
      body.taskId ?? body.TaskId ?? body.id,
      0
    );
    const taskName = pickValue(body.TaskName, body.taskName, body.title);

    if (!taskId && !taskName) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: {
          taskId: 'taskId or TaskName is required',
          TaskName: 'taskId or TaskName is required',
        },
      });
    }

    const companyId =
      leaderTeam.company_id || (await getUserCompanyId(req.user.id));

    const lookup = await getTaskForLeader(req.user.id, companyId, {
      taskId: taskId || null,
      taskName: taskId ? null : taskName,
    });

    if (lookup.ambiguous) {
      return res.status(409).json({
        success: false,
        message: 'Multiple tasks found with this name. Use taskId instead.',
        errors: {
          TaskName: 'Multiple tasks match this name',
        },
      });
    }

    if (!lookup.task) {
      return res.status(404).json({
        success: false,
        message: 'Task not found in your team',
        errors: {
          TaskName: 'Task not found',
        },
      });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM tasks WHERE id = $1`,
      [lookup.task.id]
    );

    if (!rowCount) {
      return res.status(404).json({
        success: false,
        message: 'Task not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Task deleted successfully',
      data: {
        taskId: lookup.task.id,
        TaskName: lookup.task.title,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.addEmployeeToTeam = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);
    if (!team) {
      return res.status(404).json({ success: false, message: 'No team found' });
    }

    const employeeName = String(
      req.body.Employee ?? req.body.employee ?? ''
    ).trim();

    if (!employeeName) {
      return res.status(400).json({
        success: false,
        message: 'Employee name is required',
        errors: {
          Employee: 'Employee name is required',
        },
      });
    }

    const { rows: employees } = await pool.query(
      `SELECT id, name, email, role, team_id
       FROM users
       WHERE company_id = $1
         AND LOWER(TRIM(name)) = LOWER($2)
         AND role IN ('team_member', 'team_leader')
       ORDER BY id ASC
       LIMIT 1`,
      [team.company_id, employeeName]
    );

    if (!employees.length) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found in your company',
        errors: {
          Employee: `"${employeeName}" is not an employee of your company`,
        },
      });
    }

    const employee = employees[0];

    if (employee.team_id === team.id) {
      return res.status(409).json({
        success: false,
        message: 'Employee is already a member of this team',
        errors: {
          Employee: `"${employee.name}" is already on your team`,
        },
      });
    }

    const role =
      req.body.role && String(req.body.role).trim()
        ? String(req.body.role).trim().toLowerCase()
        : 'team_member';

    if (!['team_member', 'team_leader'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role',
        errors: {
          role: 'Role must be team_member or team_leader',
        },
      });
    }

    const { rows: updatedRows } = await pool.query(
      `UPDATE users
       SET team_id = $1, role = $2, updated_at = NOW()
       WHERE id = $3 AND company_id = $4
       RETURNING id, name, email, role, team_id`,
      [team.id, role, employee.id, team.company_id]
    );

    const updatedEmployee = updatedRows[0];

    return res.status(200).json({
      success: true,
      message: 'Employee assigned to team',
      data: {
        Employee: updatedEmployee.name,
        employeeId: updatedEmployee.id,
        email: updatedEmployee.email,
        role: updatedEmployee.role,
        teamId: team.id,
      },
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
