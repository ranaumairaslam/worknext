const express = require('express');
const pool = require('../../config/db');

const router = express.Router();

const allowedTaskStatuses = ['todo', 'in_progress', 'done', 'blocked'];
const allowedTaskPriorities = ['low', 'medium', 'high'];

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const authorizeRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this resource' });
  }
  next();
};

// GET /api/company/tasks - List tasks
router.get('/', async (req, res, next) => {
  try {
    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = allowedTaskStatuses.includes(req.query.status) ? req.query.status : null;
    const assigneeId = positiveInteger(req.query.assigneeId, 0, 1000000000);
    const projectId = positiveInteger(req.query.projectId, 0, 1000000000);

    const where = ['company_id = $1'];
    const values = [req.company.id];

    if (search) {
      values.push(`%${search}%`);
      where.push(`title ILIKE $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`status = $${values.length}`);
    }
    if (assigneeId) {
      values.push(assigneeId);
      where.push(`assignee_id = $${values.length}`);
    }
    if (projectId) {
      values.push(projectId);
      where.push(`project_id = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;
    const tasks = await pool.query(
      `SELECT id, title, status, priority, due_date, project_id, assignee_id, created_at
       FROM tasks ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM tasks ${whereClause}`, values);

    res.json({ success: true, data: tasks.rows, pagination: { page, limit, total: count.rows[0].total } });
  } catch (error) {
    next(error);
  }
});

// POST /api/company/tasks - Create task
router.post('/', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const { title, description, projectId, assigneeId, dueDate, priority = 'medium' } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }
    if (!projectId) {
      return res.status(400).json({ success: false, message: 'Project ID is required' });
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid task priority' });
    }

    const project = await pool.query('SELECT id FROM projects WHERE id = $1 AND company_id = $2', [projectId, req.company.id]);
    if (!project.rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found in this company' });
    }

    if (assigneeId) {
      const assignee = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [assigneeId, req.company.id]);
      if (!assignee.rows[0]) {
        return res.status(404).json({ success: false, message: 'Assignee not found in this company' });
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, description, project_id, company_id, assignee_id, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, 'todo', $6, $7)
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at`,
      [title.trim(), description || null, projectId, req.company.id, assigneeId || null, priority, dueDate || null]
    );

    res.status(201).json({ success: true, message: 'Task created', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/tasks/:taskId - Get task details
router.get('/:taskId', async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date,
              t.project_id, p.name AS project_name,
              t.assignee_id, u.name AS assignee_name
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/tasks/:taskId - Update task details
router.put('/:taskId', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    const { title, description, assigneeId, dueDate, priority, status } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }
    if (status && !allowedTaskStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid task status' });
    }
    if (priority && !allowedTaskPriorities.includes(priority)) {
      return res.status(400).json({ success: false, message: 'Invalid task priority' });
    }
    if (assigneeId) {
      const assignee = await pool.query('SELECT id FROM users WHERE id = $1 AND company_id = $2', [assigneeId, req.company.id]);
      if (!assignee.rows[0]) {
        return res.status(404).json({ success: false, message: 'Assignee not found in this company' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE tasks SET
         title = COALESCE(NULLIF($1, ''), title),
         description = COALESCE($2, description),
         assignee_id = COALESCE($3, assignee_id),
         due_date = COALESCE($4, due_date),
         priority = COALESCE(NULLIF($5, ''), priority),
         status = COALESCE(NULLIF($6, ''), status),
         updated_at = NOW()
       WHERE id = $7 AND company_id = $8
       RETURNING id, title, description, project_id, assignee_id, status, priority, due_date, created_at`,
      [title, description, assigneeId || null, dueDate || null, priority, status, taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, message: 'Task updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/company/tasks/:taskId/status - Update task status
router.patch('/:taskId/status', authorizeRole('company', 'team_leader'), async (req, res, next) => {
  try {
    const taskId = positiveInteger(req.params.taskId, 0, 1000000000);
    const { status } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'Invalid task id' });
    }
    if (!allowedTaskStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid task status' });
    }

    const { rows } = await pool.query(
      'UPDATE tasks SET status = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3 RETURNING id, title, status, priority, due_date, assignee_id, project_id',
      [status, taskId, req.company.id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    res.json({ success: true, message: 'Task status updated', data: rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
