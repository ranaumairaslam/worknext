const express = require('express');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const taskRoutes = require('./tasks');
const meetingRoutes = require('./meetings');

const router = express.Router();

router.get('/dashboard', protect, authorize('team_member'), (req, res) => {
  return res.status(200).json({
    success: true,
    code: 200,
    dashboard: 'team_member',
    message: 'Team member dashboard',
  });
});

router.use('/tasks', taskRoutes);
router.use('/meetings', meetingRoutes);

module.exports = router;
