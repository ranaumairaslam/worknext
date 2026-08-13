const express = require("express");

const router = express.Router();

const protect =
  require("../../middleware/auth.middleware");

const authorize =
  require("../../middleware/role.middleware");

const {
  getDashboard,
  viewAssignedProjects,
  viewTeamMembers,
  addEmployeeToTeam,

  createTask,
  assignTask,
  updateTaskPriority,
  viewTasks,

  reviewSubmittedTasks,
  approveTask,
  returnTaskForRevision,

  monitorTeamProgress,
  generateTeamReport,

  getTeamPerformance,
} = require("./teamleadercontroller");

const {
  createMeeting,
  getMeetings,
  getMeetingById,
  cancelMeeting,
  getUpcomingMeetings,
} = require("./meetings.controller");


/*
|--------------------------------------------------------------------------
| AUTHENTICATION
|--------------------------------------------------------------------------
*/

router.use(protect);


/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

router.get(
  "/dashboard",
  authorize("team_leader"),
  getDashboard
);


/*
|--------------------------------------------------------------------------
| PROJECTS
|--------------------------------------------------------------------------
*/

router.get(
  "/projects",
  authorize("team_leader"),
  viewAssignedProjects
);


/*
|--------------------------------------------------------------------------
| TEAM MEMBERS
|--------------------------------------------------------------------------
*/

router.get(
  "/team-members",
  authorize("team_leader"),
  viewTeamMembers
);


router.post(
  "/team-members",
  authorize("team_leader"),
  addEmployeeToTeam
);

// Compatibility alias for frontend/client calls that use /team/members
router.post(
  "/team/members",
  authorize("team_leader"),
  addEmployeeToTeam
);


/*
|--------------------------------------------------------------------------
| TASKS
|--------------------------------------------------------------------------
*/

/*
GET /api/team-leader/tasks
*/

router.get(
  "/tasks",
  authorize("team_leader"),
  viewTasks
);


/*
POST /api/team-leader/tasks
*/

router.post(
  "/tasks",
  authorize("team_leader"),
  createTask
);


/*
PUT /api/team-leader/tasks/:taskId/assign
*/

router.put(
  "/tasks/:taskId/assign",
  authorize("team_leader"),
  assignTask
);

router.patch(
  "/tasks/:taskId/assign",
  authorize("team_leader"),
  assignTask
);


/*
PUT /api/team-leader/tasks/:taskId/priority
*/

router.put(
  "/tasks/:taskId/priority",
  authorize("team_leader"),
  updateTaskPriority
);

router.patch(
  "/tasks/:taskId/priority",
  authorize("team_leader"),
  updateTaskPriority
);


/*
GET submitted tasks
*/

router.get(
  "/tasks/submitted",
  authorize("team_leader"),
  reviewSubmittedTasks
);


/*
POST approve
*/

router.post(
  "/tasks/:taskId/approve",
  authorize("team_leader"),
  approveTask
);

router.put(
  "/tasks/:taskId/approve",
  authorize("team_leader"),
  approveTask
);


/*
POST return for revision
*/

router.post(
  "/tasks/:taskId/revision",
  authorize("team_leader"),
  returnTaskForRevision
);

router.put(
  "/tasks/:taskId/revision",
  authorize("team_leader"),
  returnTaskForRevision
);


/*
|--------------------------------------------------------------------------
| TEAM PERFORMANCE
|--------------------------------------------------------------------------
*/

router.get(
  "/team-performance",
  authorize("team_leader"),
  getTeamPerformance
);


/*
|--------------------------------------------------------------------------
| PROGRESS
|--------------------------------------------------------------------------
*/

router.get(
  "/progress",
  authorize("team_leader"),
  monitorTeamProgress
);


/*
|--------------------------------------------------------------------------
| REPORT
|--------------------------------------------------------------------------
*/

router.get(
  "/reports",
  authorize("team_leader"),
  generateTeamReport
);


/*
|--------------------------------------------------------------------------
| MEETINGS
|--------------------------------------------------------------------------
*/

/*
POST
Team Leader schedules meeting
*/

router.post(
  "/meetings",
  authorize("team_leader"),
  createMeeting
);


/*
GET
All meetings for this team

Includes:
Company Admin meetings
Team Leader meetings
*/

router.get(
  "/meetings",
  authorize("team_leader"),
  getMeetings
);


/*
GET
Upcoming meetings
*/

router.get(
  "/meetings/upcoming",
  authorize("team_leader"),
  getUpcomingMeetings
);


/*
GET
Single meeting
*/

router.get(
  "/meetings/:meetingId",
  authorize("team_leader"),
  getMeetingById
);


/*
PATCH
Cancel meeting
*/

router.patch(
  "/meetings/:meetingId/cancel",
  authorize("team_leader"),
  cancelMeeting
);


module.exports = router;