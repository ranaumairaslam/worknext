// team-member/data/store.js
const now = new Date();

// =========================
// Task Data
// =========================
// Assigned team-member tasks are now loaded from the database via the
// /api/team-member/tasks/assigned endpoint. This in-memory task list is no
// longer used for assigned task responses.
const tasks = [];

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
    participants: [37, 2, 3],                // ✅ You included
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
    participants: [37, 4, 5],                // ✅ You included
    status: "scheduled",
    location: "Online"
  },
  {
    meetingId: "meeting-3",
    title: "Client Demo",
    description: "Present dashboard demo to client",
    startTime: new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now.getTime() + 49 * 60 * 60 * 1000).toISOString(),
    link: "https://meet.google.com/demo-2026-xyz",
    participants: [37, 1, 4],                // ✅ You included
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