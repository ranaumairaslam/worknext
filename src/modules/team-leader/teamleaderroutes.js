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

router.use(protect, authorize("team_leader"));

// Test Route
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Team Leader Routes Working",
  });
});

// Dashboard
router.get("/dashboard", getDashboard);

// View Assigned Projects
router.get("/projects", viewAssignedProjects);

// View Team Members
router.get("/team-members", viewTeamMembers);

// Add Employee to Team
router.post("/team/members", addEmployeeToTeam);

// Create Task
router.post("/tasks", createTask);

// Assign Task
router.put("/tasks/:taskId/assign", assignTask);

// Update Task Priority
router.put("/tasks/:taskId/priority", updateTaskPriority);

// View Tasks
router.get("/tasks", viewTasks);

// Review Submitted Tasks
router.get("/tasks/submitted", reviewSubmittedTasks);

// Approve Task
router.put("/tasks/:taskId/approve", approveTask);

// Return Task for Revision
router.put("/tasks/:taskId/revision", returnTaskForRevision);

// Monitor Progress
router.get("/progress", monitorTeamProgress);

// Generate Report
router.get("/reports", generateTeamReport);

module.exports = router;