const getLeaderTeam = async () => ({
  id: 1,
  name: "Default Team",
});

const getProjects = async () => [];
const getMembers = async () => [];
const getTaskSummary = async () => ({
  total: 0,
  pending: 0,
  completed: 0,
});
const createNewTask = async (body, userId) => ({
  id: Date.now(),
  ...body,
  createdBy: userId,
  status: "pending",
});
const assignTaskToMember = async (taskId, assignedTo) => ({
  taskId,
  assignedTo,
  status: "assigned",
});
const getTasks = async () => [];
const getSubmittedTasks = async () => [];
const approveTaskById = async (taskId) => ({ taskId, status: "approved" });
const returnTask = async (taskId, reviewNote) => ({
  taskId,
  status: "revision",
  reviewNote,
});
const getProgress = async () => ({ progress: 0 });
const generateReport = async (userId, from, to) => ({
  userId,
  from,
  to,
  summary: {
    totalTasks: 0,
    completed: 0,
  },
});

const sendNotImplemented = (res, message) => {
  return res.status(501).json({
    success: false,
    message,
  });
};

exports.addEmployeeToTeam = async (req, res) => {
  return sendNotImplemented(res, "Add employee to team is not implemented yet.");
};

exports.updateTaskPriority = async (req, res) => {
  return sendNotImplemented(res, "Update task priority is not implemented yet.");
};

// ===============================
// Dashboard
// ===============================
exports.getDashboard = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team assigned to this Team Leader",
      });
    }

    const projects = await getProjects(team.id);
    const members = await getMembers(team.id);
    const tasks = await getTaskSummary(team.id);

    return res.status(200).json({
      success: true,
      data: {
        team,
        totalProjects: projects.length,
        totalMembers: members.length,
        tasks,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// View Assigned Projects
// ===============================
exports.viewAssignedProjects = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const projects = await getProjects(team.id);

    res.json({
      success: true,
      data: projects,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// View Team Members
// ===============================
exports.viewTeamMembers = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const members = await getMembers(team.id);

    res.json({
      success: true,
      data: members,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Create Task
// ===============================
exports.createTask = async (req, res) => {
  try {
    const task = await createNewTask(req.body, req.user.id);

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: task,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Assign Task
// ===============================
exports.assignTask = async (req, res) => {
  try {
    const task = await assignTaskToMember(
      req.params.taskId,
      req.body.assignedTo
    );

    res.json({
      success: true,
      message: "Task assigned successfully",
      data: task,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// View Tasks
// ===============================
exports.viewTasks = async (req, res) => {
  try {
    const tasks = await getTasks(req.query);

    res.json({
      success: true,
      data: tasks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Review Submitted Tasks
// ===============================
exports.reviewSubmittedTasks = async (req, res) => {
  try {
    const tasks = await getSubmittedTasks(req.user.id);

    res.json({
      success: true,
      data: tasks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Approve Task
// ===============================
exports.approveTask = async (req, res) => {
  try {
    const task = await approveTaskById(req.params.taskId);

    res.json({
      success: true,
      message: "Task approved",
      data: task,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Return Task For Revision
// ===============================
exports.returnTaskForRevision = async (req, res) => {
  try {
    const task = await returnTask(
      req.params.taskId,
      req.body.reviewNote
    );

    res.json({
      success: true,
      message: "Task returned for revision",
      data: task,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Monitor Team Progress
// ===============================
exports.monitorTeamProgress = async (req, res) => {
  try {
    const report = await getProgress(req.user.id);

    res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

// ===============================
// Generate Report
// ===============================
exports.generateTeamReport = async (req, res) => {
  try {
    const report = await generateReport(
      req.user.id,
      req.query.from,
      req.query.to
    );

    res.json({
      success: true,
      data: report,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};