const now = new Date();

const meetings = [
  {
    meetingId: 'meeting-1',
    title: 'Daily Standup',
    description: 'Daily review of progress, blockers, and planned work.',
    startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    endTime: new Date(now.getTime() + 90 * 60 * 1000).toISOString(),
    link: 'https://example.com/meet/team-standup',
    participants: [1, 2, 3],
    status: 'scheduled',
    location: 'Online'
  },
  {
    meetingId: 'meeting-2',
    title: 'Sprint Review',
    description: 'Review completed tasks and identify next sprint priorities.',
    startTime: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    endTime: new Date(now.getTime() + 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    link: 'https://example.com/meet/sprint-review',
    participants: [1, 4, 5],
    status: 'scheduled',
    location: 'Online'
  }
];

const tasks = [
  {
    taskId: 'task-1',
    title: 'Design user profile screen',
    description: 'Create mockups and hand off to frontend.',
    assignedTo: 1,
    status: 'todo',
    priority: 'high',
    dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    taskId: 'task-2',
    title: 'Implement API integration',
    description: 'Connect frontend to backend task endpoints.',
    assignedTo: 1,
    status: 'in_progress',
    priority: 'medium',
    dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  }
];

const submissions = [];
let nextSubmissionSequence = 1;

function nextSubmissionId() {
  return `submission-${Date.now()}-${nextSubmissionSequence++}`;
}

module.exports = {
  meetings,
  tasks,
  submissions,
  nextSubmissionId,
};
