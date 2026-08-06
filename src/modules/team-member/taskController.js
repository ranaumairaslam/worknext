const { tasks, submissions, nextSubmissionId } = require('./data/store');

// GET /api/v1/tasks/assigned
function getAssignedTasks(req, res) {
  const userId = req.user.id;
  const { status, priority, page = 1, limit = 10 } = req.query;

  let result = tasks.filter((t) => t.assignedTo === userId);

  if (status) result = result.filter((t) => t.status === status);
  if (priority) result = result.filter((t) => t.priority === priority);

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const start = (pageNum - 1) * limitNum;
  const paginated = result.slice(start, start + limitNum);

  res.json({
    data: paginated,
    page: pageNum,
    totalPages: Math.ceil(result.length / limitNum) || 1,
    totalItems: result.length,
  });
}

// GET /api/v1/tasks/:taskId
function getTaskById(req, res) {
  const task = tasks.find((t) => t.taskId === req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assignedTo !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to view this task' });
  }

  res.json(task);
}

// POST /api/v1/tasks/:taskId/start
function startTask(req, res) {
  const task = tasks.find((t) => t.taskId === req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assignedTo !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to start this task' });
  }
  if (task.status !== 'todo') {
    return res.status(409).json({ error: 'Task cannot be started from its current status' });
  }

  task.status = 'in_progress';
  task.startedAt = new Date().toISOString();

  res.json({ success: true, message: 'Task started', task });
}

// POST /api/v1/tasks/:taskId/submit
function submitTask(req, res) {
  const task = tasks.find((t) => t.taskId === req.params.taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  if (task.assignedTo !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to submit this task' });
  }
  if (task.status === 'submitted' || task.status === 'approved' || task.status === 'done') {
    return res.status(409).json({ error: `Task already ${task.status}` });
  }

  const { comment = '', attachments = [] } = req.body;

  const submission = {
    submissionId: nextSubmissionId(),
    taskId: task.taskId,
    submittedBy: req.user.id,
    comment,
    attachments,
    submittedAt: new Date().toISOString(),
    status: 'under_review', // under_review | approved | rejected
    reviewerComment: null,
  };

  submissions.push(submission);
  task.status = 'submitted';

  res.status(201).json({ success: true, message: 'Task submitted for review', submission });
}

// GET /api/v1/tasks/submissions
function getMySubmissions(req, res) {
  const mine = submissions.filter((s) => s.submittedBy === req.user.id);
  res.json({ data: mine });
}

// GET /api/v1/tasks/submissions/:submissionId
function getSubmissionById(req, res) {
  const submission = submissions.find(
    (s) => s.submissionId === req.params.submissionId
  );

  if (!submission) {
    return res.status(404).json({ error: 'Submission not found' });
  }
  if (submission.submittedBy !== req.user.id) {
    return res.status(403).json({ error: 'Not authorized to view this submission' });
  }

  res.json(submission);
}

module.exports = {
  getAssignedTasks,
  getTaskById,
  startTask,
  submitTask,
  getMySubmissions,
  getSubmissionById,
};
