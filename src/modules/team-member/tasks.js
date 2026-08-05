const express = require('express');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const {
  getAssignedTasks,
  getTaskById,
  startTask,
  submitTask,
  getMySubmissions,
  getSubmissionById,
} = require('./taskController');

const router = express.Router();

router.use(protect, authorize('team_member'));

router.get('/assigned', getAssignedTasks);
router.get('/submissions', getMySubmissions);
router.get('/submissions/:submissionId', getSubmissionById);
router.get('/:taskId', getTaskById);
router.post('/:taskId/start', startTask);
router.post('/:taskId/submit', submitTask);

module.exports = router;
