const pool = require('../../config/db');

// GET /api/team-member/tasks/assigned
const positiveInteger = (value, fallback = 1, maximum = 1000000000) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

function parseStringQuery(value) {
  return value ? String(value).trim() : null;
}

// GET /api/team-member/tasks/assigned
async function getAssignedTasks(req, res, next) {
  try {
    const userId = positiveInteger(req.user.id, 0);
    const status = parseStringQuery(req.query.status);
    const priority = parseStringQuery(req.query.priority);
    const pageNum = positiveInteger(req.query.page, 1, 1000);
    const limitNum = positiveInteger(req.query.limit, 10, 100);
    const offset = (pageNum - 1) * limitNum;

    const where = ['t.assignee_id = $1'];
    const values = [userId];

    if (status) {
      values.push(status);
      where.push(`t.status = $${values.length}`);
    }
    if (priority) {
      values.push(priority);
      where.push(`t.priority = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const tasksResult = await pool.query(
      `SELECT t.id AS taskId,
              t.title,
              t.description,
              t.status,
              t.priority,
              t.due_date AS "dueDate",
              p.name AS "projectName",
              u.name AS "assigneeName"
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       ${whereClause}
       ORDER BY t.due_date NULLS LAST, t.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limitNum, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM tasks t
       ${whereClause}`,
      values
    );

    const totalItems = countResult.rows[0]?.total || 0;

    res.json({
      data: tasksResult.rows,
      page: pageNum,
      totalPages: Math.ceil(totalItems / limitNum) || 1,
      totalItems,
    });
  } catch (error) {
    next(error);
  }
}

// GET /api/team-member/tasks/:taskId
async function getTaskById(req, res, next) {
  try {
    const taskId = positiveInteger(req.params.taskId, 0);
    if (!taskId) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `SELECT t.id AS taskId,
              t.title,
              t.description,
              t.status,
              t.priority,
              t.due_date AS "dueDate",
              p.name AS "projectName",
              u.name AS "assigneeName"
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1
         AND t.assignee_id = $2`,
      [taskId, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
}

// POST /api/team-member/tasks/:taskId/start
async function startTask(req, res, next) {
  try {
    const taskId = positiveInteger(req.params.taskId, 0);
    if (!taskId) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `SELECT id, status
       FROM tasks
       WHERE id = $1
         AND assignee_id = $2`,
      [taskId, req.user.id]
    );

    const task = rows[0];
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.status !== 'todo') {
      return res.status(409).json({ error: 'Task cannot be started from its current status' });
    }

    const updateResult = await pool.query(
      `UPDATE tasks
       SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1
         AND assignee_id = $2
       RETURNING id AS taskId, title, description, status, priority, due_date AS "dueDate"`,
      [taskId, req.user.id]
    );

    res.json({ success: true, message: 'Task started', task: updateResult.rows[0] });
  } catch (error) {
    next(error);
  }
}

// POST /api/team-member/tasks/:taskId/submit
async function submitTask(req, res, next) {
  try {
    const taskId = positiveInteger(req.params.taskId, 0);
    if (!taskId) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `SELECT id, status
       FROM tasks
       WHERE id = $1
         AND assignee_id = $2`,
      [taskId, req.user.id]
    );

    const task = rows[0];
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (['submitted', 'approved', 'done'].includes(task.status)) {
      return res.status(409).json({ error: `Task already ${task.status}` });
    }

    const { comment = '', attachments = [] } = req.body;

    const updateResult = await pool.query(
      `UPDATE tasks
       SET status = 'submitted', updated_at = NOW()
       WHERE id = $1
         AND assignee_id = $2
       RETURNING id AS taskId, title, description, status, priority, due_date AS "dueDate"`,
      [taskId, req.user.id]
    );

    // We don't currently persist submission metadata to the database.
    res.status(201).json({
      success: true,
      message: 'Task submitted for review',
      submission: {
        taskId,
        submittedBy: req.user.id,
        comment,
        attachments,
        submittedAt: new Date().toISOString(),
        status: 'under_review',
      },
      task: updateResult.rows[0],
    });
  } catch (error) {
    next(error);
  }
}

function getMySubmissions(req, res) {
  res.json({ data: [] });
}

function getSubmissionById(req, res) {
  res.status(404).json({ error: 'Submission not found' });
}

module.exports = {
  getAssignedTasks,
  getTaskById,
  startTask,
  submitTask,
  getMySubmissions,
  getSubmissionById,
};
