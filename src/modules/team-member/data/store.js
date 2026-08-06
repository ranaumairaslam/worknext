const now = new Date();

// =========================
// Dummy Tasks
// =========================
const tasks = [
  {
    taskId: "task-1",
    title: "Build Login API",
    description: "Develop login API using JWT authentication.",
    assignedTo: 1,
    priority: "high",
    status: "todo",
    dueDate: "2026-08-10"
  },
  {
    taskId: "task-2",
    title: "Dashboard UI",
    description: "Complete Team Member Dashboard.",
    assignedTo: 1,
    priority: "medium",
    status: "todo",
    dueDate: "2026-08-12"
  },
  {
    taskId: "task-3",
    title: "Project API",
    description: "Create CRUD APIs for Projects.",
    assignedTo: 2,
    priority: "low",
    status: "in_progress",
    dueDate: "2026-08-15"
  }
];

// =========================
// Dummy Meetings
// =========================
const meetings = [
  {
    meetingId: "meeting-1",
    title: "Daily Standup",
    description: "Daily project discussion",
    startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    endTime: new Date(now.getTime() + 90 * 60 * 1000).toISOString(),
    link: "https://meet.google.com/abc-defg-hij",
    participants: [1, 2, 3],
    status: "scheduled",
    location: "Online"
  },
  {
    meetingId: "meeting-2",
    title: "Sprint Review",
    description: "Review sprint progress",
    startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now.getTime() + 25 * 60 * 60 * 1000).toISOString(),
    link: "https://meet.google.com/xyz-abcd-123",
    participants: [1, 4, 5],
    status: "scheduled",
    location: "Online"
  }
];

// =========================
// Task Submissions
// =========================
const submissions = [];

let submissionCounter = 1;

function nextSubmissionId() {
  return `submission-${submissionCounter++}`;
}

module.exports = {
  tasks,
  meetings,
  submissions,
  nextSubmissionId,
};