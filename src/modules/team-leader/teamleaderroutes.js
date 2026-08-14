const express = require('express');

const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const {
  getDashboard,
  viewAssignedProjects,
  viewTeamMembers,
  addEmployeeToTeam,
  getTeamMembersByTeamName,
  assignTaskByNames,
  editTaskByNames,
  deleteTaskByNames,
  createTask,
  assignTask,
  updateTaskPriority,
  viewTasks,
  reviewSubmittedTasks,
  approveTask,
  returnTaskForRevision,
  monitorTeamProgress,
  generateTeamReport,
} = require('./teamleadercontroller');

const router = express.Router();

// Legacy URLs → single /members endpoint
router.use((req, res, next) => {
  if (req.path === '/team-members' || req.path === '/team/members') {
    req.url = '/members';
  }
  next();
});

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

router.use(protect, authorize('team_leader'));

console.log('✅ Team Leader Routes Loaded');

router
  .route('/test')
  .get((req, res) => {
    res.json({
      success: true,
      message: 'Team Leader Routes Working',
    });
  })
  .all(methodNotAllowed(['GET']));

router
  .route('/dashboard')
  .get(getDashboard)
  .all(methodNotAllowed(['GET']));

router
  .route('/projects')
  .get(viewAssignedProjects)
  .all(methodNotAllowed(['GET']));

router
  .route('/members')
  .get(viewTeamMembers)
  .post(addEmployeeToTeam)
  .all(methodNotAllowed(['GET', 'POST']));

router
  .route('/teams/members')
  .get(getTeamMembersByTeamName)
  .all(methodNotAllowed(['GET']));

router
  .route('/tasks/submitted')
  .get(reviewSubmittedTasks)
  .all(methodNotAllowed(['GET']));

router
  .route('/tasks/assign')
  .post(assignTaskByNames)
  .put(editTaskByNames)
  .delete(deleteTaskByNames)
  .all(methodNotAllowed(['POST', 'PUT', 'DELETE']));

router
  .route('/tasks')
  .get(viewTasks)
  .post(createTask)
  .all(methodNotAllowed(['GET', 'POST']));

router
  .route('/tasks/:taskId/assign')
  .put(assignTask)
  .all(methodNotAllowed(['PUT']));

router
  .route('/tasks/:taskId/priority')
  .put(updateTaskPriority)
  .all(methodNotAllowed(['PUT']));

router
  .route('/tasks/:taskId/approve')
  .put(approveTask)
  .all(methodNotAllowed(['PUT']));

router
  .route('/tasks/:taskId/revision')
  .put(returnTaskForRevision)
  .all(methodNotAllowed(['PUT']));

router
  .route('/progress')
  .get(monitorTeamProgress)
  .all(methodNotAllowed(['GET']));

router
  .route('/reports')
  .get(generateTeamReport)
  .all(methodNotAllowed(['GET']));

router.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: 404,
    message: 'Route not found',
    hint: 'Team leader routes: POST/PUT/DELETE /api/team-leader/tasks/assign, GET /api/team-leader/teams/members?TeamName=...',
  });
});

module.exports = router;
