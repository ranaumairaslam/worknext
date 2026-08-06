const express = require('express');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');
const { getUpcomingMeetings, joinMeeting } = require('./meetingController');

const router = express.Router();

router.use(protect, authorize('team_member'));

router.get('/upcoming', getUpcomingMeetings);
router.post('/:meetingId/join', joinMeeting);

module.exports = router;
