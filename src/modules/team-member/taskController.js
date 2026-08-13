// modules/team-member/taskController.js
const pool = require('../../config/db');

// ============================================================
// GET /api/team-member/tasks/assigned
// Returns tasks assigned to the logged-in user with pagination
// ============================================================
async function getAssignedTasks(req, res, next) {
  try {
    const userId = req.user.id;
    const { status, priority, page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
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

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM tasks t ${whereClause}`,
      values
    );
    const total = countResult.rows[0].total;

    // Fetch paginated
    const { rows } = await pool.query(
      `
      SELECT
        t.id            AS "taskId",
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date      AS "dueDate",
        t.project_id    AS "projectId",
        p.name          AS "projectName",
        t.assignee_id   AS "assigneeId",
        u.name          AS "assigneeName",
        t.created_at    AS "createdAt",
        t.updated_at    AS "updatedAt"
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `,
      [...values, limitNum, offset]
    );

    return res.json({
      data: rows,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
    });
  } catch (error) {
    next(error);
  }
}

// ============================================================
// GET /api/team-member/tasks/:taskId
// ============================================================
async function getTaskById(req, res, next) {
  try {
    const taskId = Number.parseInt(req.params.taskId, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `
      SELECT
        t.id            AS "taskId",
        t.title,
        t.description,
        t.status,
        t.priority,
        t.due_date      AS "dueDate",
        t.project_id    AS "projectId",
        p.name          AS "projectName",
        t.assignee_id   AS "assigneeId",
        u.name          AS "assigneeName",
        t.created_at    AS "createdAt"
      FROM tasks t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.id = $1
      `,
      [taskId]
    );

    const task = rows[0];
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.assigneeId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to view this task' });
    }

    return res.json(task);
  } catch (error) {
    next(error);
  }
}

// ============================================================
// POST /api/team-member/tasks/:taskId/start
// Move task from "todo" → "in_progress"
// ============================================================
async function startTask(req, res, next) {
  try {
    const taskId = Number.parseInt(req.params.taskId, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    // Verify ownership + current status
    const check = await pool.query(
      `SELECT id, assignee_id, status FROM tasks WHERE id = $1`,
      [taskId]
    );
    const task = check.rows[0];

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.assignee_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to start this task' });
    }
    if (task.status !== 'todo') {
      return res.status(409).json({
        error: `Task cannot be started from its current status (${task.status})`,
      });
    }

    // Update status
    const { rows } = await pool.query(
      `
      UPDATE tasks
      SET status = 'in_progress', updated_at = NOW()
      WHERE id = $1
      RETURNING id AS "taskId", title, status, priority, due_date AS "dueDate", assignee_id AS "assigneeId"
      `,
      [taskId]
    );

    return res.json({
      success: true,
      message: 'Task started',
      task: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

// ============================================================
// POST /api/team-member/tasks/:taskId/submit
// Mark task as submitted for review
// (Uses task_submissions table if it exists, else just updates status)
// ============================================================
async function submitTask(req, res, next) {
  try {
    const taskId = Number.parseInt(req.params.taskId, 10);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return res.status(400).json({ error: 'Invalid task id' });
    }

    const check = await pool.query(
      `SELECT id, assignee_id, status FROM tasks WHERE id = $1`,
      [taskId]
    );
    const task = check.rows[0];

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.assignee_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to submit this task' });
    }
    if (task.status === 'done') {
      return res.status(409).json({ error: 'Task already completed' });
    }

    const { comment = '', attachments = [] } = req.body || {};

    // Try to insert into task_submissions (if table exists)
    let submission = null;
    try {
      const insertResult = await pool.query(
        `
        INSERT INTO task_submissions
          (task_id, submitted_by, comment, attachments, status, submitted_at)
        VALUES ($1, $2, $3, $4, 'under_review', NOW())
        RETURNING
          id           AS "submissionId",
          task_id      AS "taskId",
          submitted_by AS "submittedBy",
          comment,
          attachments,
          status,
          submitted_at AS "submittedAt"
        `,
        [taskId, req.user.id, comment, JSON.stringify(attachments)]
      );
      submission = insertResult.rows[0];
    } catch (err) {
      // task_submissions table doesn't exist — skip silently
      console.warn('task_submissions table not available:', err.message);
    }

    // Update task status to 'done' (backend uses only: todo, in_progress, done, blocked)
    await pool.query(
      `UPDATE tasks SET status = 'done', updated_at = NOW() WHERE id = $1`,
      [taskId]
    );

    return res.status(201).json({
      success: true,
      message: 'Task submitted for review',
      submission: submission || {
        taskId,
        submittedBy: req.user.id,
        comment,
        attachments,
        status: 'under_review',
        submittedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
}

// ============================================================
// GET /api/team-member/tasks/submissions
// ============================================================
async function getMySubmissions(req, res, next) {
  try {
    // Try to query task_submissions table
    try {
      const { rows } = await pool.query(
        `
        SELECT
          s.id            AS "submissionId",
          s.task_id       AS "taskId",
          s.submitted_by  AS "submittedBy",
          s.comment,
          s.attachments,
          s.status,
          s.submitted_at  AS "submittedAt",
          s.reviewer_comment AS "reviewerComment",
          t.title         AS "taskTitle"
        FROM task_submissions s
        LEFT JOIN tasks t ON t.id = s.task_id
        WHERE s.submitted_by = $1
        ORDER BY s.submitted_at DESC
        `,
        [req.user.id]
      );

      return res.json({ data: rows });
    } catch (err) {
      // Table doesn't exist yet
      return res.json({ data: [] });
    }
  } catch (error) {
    next(error);
  }
}

// ============================================================
// GET /api/team-member/tasks/submissions/:submissionId
// ============================================================
async function getSubmissionById(req, res, next) {
  try {
    const submissionId = Number.parseInt(req.params.submissionId, 10);
    if (!Number.isInteger(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: 'Invalid submission id' });
    }

    try {
      const { rows } = await pool.query(
        `
        SELECT
          s.id            AS "submissionId",
          s.task_id       AS "taskId",
          s.submitted_by  AS "submittedBy",
          s.comment,
          s.attachments,
          s.status,
          s.submitted_at  AS "submittedAt",
          s.reviewer_comment AS "reviewerComment"
        FROM task_submissions s
        WHERE s.id = $1
        `,
        [submissionId]
      );

      const submission = rows[0];
      if (!submission) {
        return res.status(404).json({ error: 'Submission not found' });
      }
      if (submission.submittedBy !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to view this submission' });
      }

      return res.json(submission);
    } catch (err) {
      return res.status(404).json({ error: 'Submission not found' });
    }
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAssignedTasks,
  getTaskById,
  startTask,
  submitTask,
  getMySubmissions,
  getSubmissionById,
};