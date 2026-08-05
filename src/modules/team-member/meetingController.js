const { meetings } = require('../data/store');

// GET /api/v1/meetings/upcoming
function getUpcomingMeetings(req, res) {
  const userId = req.user.id;
  const now = new Date();

  const upcoming = meetings.filter(
    (m) => m.participants.includes(userId) && new Date(m.endTime) >= now
  );

  res.json({ data: upcoming });
}

// POST /api/v1/meetings/:meetingId/join
function joinMeeting(req, res) {
  const meeting = meetings.find((m) => m.meetingId === req.params.meetingId);

  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  if (!meeting.participants.includes(req.user.id)) {
    return res.status(403).json({ error: 'You are not invited to this meeting' });
  }

  meeting.status = 'live';
  meeting.joinedAt = new Date().toISOString();

  res.json({
    meetingId: meeting.meetingId,
    title: meeting.title,
    joinUrl: `${meeting.link}?token=demo-${req.user.id}`,
    status: 'joined',
    startedAt: meeting.joinedAt,
  });
}

module.exports = { getUpcomingMeetings, joinMeeting };
