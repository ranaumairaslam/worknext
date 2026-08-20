const express = require('express');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const taskRoutes = require('./tasks');
const meetingRoutes = require('./meetings');
const { handleSubmitUpload } = require('./submit.middleware');
const { createSubmission } = require('./submit.controller');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

router.use(protect, authorize('team_member'));

router
  .route('/dashboard')
  .get((req, res) => {
    return res.status(200).json({
      success: true,
      code: 200,
      dashboard: 'team_member',
      message: 'Team member dashboard',
    });
  })
  .all(methodNotAllowed(['GET']));

router
  .route('/submit')
  .post(handleSubmitUpload, createSubmission)
  .all(methodNotAllowed(['POST']));

router.use('/tasks', taskRoutes);
router.use('/meetings', meetingRoutes);

router.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: 404,
    message: 'Route not found',
    hint: 'Team member routes: POST /api/team-member/submit, GET /api/team-member/tasks/assigned',
  });
});

module.exports = router;
