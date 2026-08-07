// src/modules/team-leader/teamleaderroutes.js

const express = require("express");
const router = express.Router();

console.log("✅ Team Leader Routes Loaded");

const protect = require("../../middleware/auth.middleware");
const authorize = require("../../middleware/role.middleware");

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
} = require("./teamleadercontroller");

// Test Route
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Team Leader Routes Working",
  });
});

// Dashboard
router.get(
  "/dashboard",
  protect,
  authorize("team_leader"),
  getDashboard
);

// View Assigned Projects
router.get(
  "/projects",
  protect,
  authorize("team_leader"),
  viewAssignedProjects
);

// View Team Members
router.get(
  "/team-members",
  protect,
  authorize("team_leader"),
  viewTeamMembers
);

// Add Employee to Team
router.post(
  "/team/members",
  protect,
  authorize("team_leader"),
  addEmployeeToTeam
);

// Create Task
router.post(
  "/tasks",
  protect,
  authorize("team_leader"),
  createTask
);

// Assign Task
router.put(
  "/tasks/:taskId/assign",
  protect,
  authorize("team_leader"),
  assignTask
);

// Update Task Priority
router.put(
  "/tasks/:taskId/priority",
  protect,
  authorize("team_leader"),
  updateTaskPriority
);

// View Tasks
router.get(
  "/tasks",
  protect,
  authorize("team_leader"),
  viewTasks
);

// Review Submitted Tasks
router.get(
  "/tasks/submitted",
  protect,
  authorize("team_leader"),
  reviewSubmittedTasks
);

// Approve Task
router.put(
  "/tasks/:taskId/approve",
  protect,
  authorize("team_leader"),
  approveTask
);

// Return Task for Revision
router.put(
  "/tasks/:taskId/revision",
  protect,
  authorize("team_leader"),
  returnTaskForRevision
);

// Monitor Progress
router.get(
  "/progress",
  protect,
  authorize("team_leader"),
  monitorTeamProgress
);

// Generate Report
router.get(
  "/reports",
  protect,
  authorize("team_leader"),
  generateTeamReport
);

module.exports = router;