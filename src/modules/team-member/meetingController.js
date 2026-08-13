// modules/team-member/meetingController.js
const pool = require('../../config/db');

// =========================================================
// GET /api/team-member/meetings/upcoming
// Returns all upcoming meetings where the logged-in user is invited:
//   - directly (meeting_members)
//   - or through a team (meeting_teams → users.team_id)
//   - or as the meeting invitee_user_id (client / project leader)
// =========================================================
async function getUpcomingMeetings(req, res, next) {
  try {
    const userId = req.user.id;

    const { rows } = await pool.query(
      `
      SELECT DISTINCT
        m.id                AS "meetingId",
        m.title,
        m.to_whom           AS "toWhom",
        m.scheduled_date    AS date,
        TO_CHAR(m.scheduled_time, 'HH24:MI') AS time,
        m.scheduled_at      AS "startTime",
        m.scheduled_at      AS "endTime",
        m.mode              AS "platform",
        m.meeting_link      AS "link",
        m.status,
        m.description,
        p.name              AS "projectName",
        (
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'id', u2.id,
                'name', u2.name,
                'email', u2.email
              )
              ORDER BY u2.name
            ),
            '[]'::json
          )
          FROM meeting_members mm2
          JOIN users u2 ON u2.id = mm2.user_id
          WHERE mm2.meeting_id = m.id
        ) AS participants
      FROM meetings m
      LEFT JOIN projects p        ON p.id = m.project_id
      LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
      LEFT JOIN meeting_teams mt   ON mt.meeting_id = m.id
      LEFT JOIN users u            ON u.id = $1
      WHERE
        m.status = 'scheduled'
        AND (m.scheduled_at IS NULL OR m.scheduled_at >= NOW())
        AND (
          mm.user_id = $1
          OR m.invitee_user_id = $1
          OR (u.team_id IS NOT NULL AND mt.team_id = u.team_id)
        )
      ORDER BY m.scheduled_at ASC NULLS LAST
      `,
      [userId]
    );

    return res.json({ data: rows });
  } catch (error) {
    next(error);
  }
}

// =========================================================
// POST /api/team-member/meetings/:meetingId/join
// Verifies user is invited, then returns a join URL
// =========================================================
async function joinMeeting(req, res, next) {
  try {
    const meetingId = Number.parseInt(req.params.meetingId, 10);
    if (!Number.isInteger(meetingId) || meetingId <= 0) {
      return res.status(400).json({ error: 'Invalid meeting id' });
    }

    // Fetch meeting
    const meetingResult = await pool.query(
      `SELECT id, title, meeting_link, mode, scheduled_at, invitee_user_id, status
       FROM meetings
       WHERE id = $1`,
      [meetingId]
    );

    const meeting = meetingResult.rows[0];
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Check if user is invited (directly, via team, or as invitee_user_id)
    const accessResult = await pool.query(
      `
      SELECT 1
      FROM meetings m
      LEFT JOIN meeting_members mm ON mm.meeting_id = m.id AND mm.user_id = $1
      LEFT JOIN meeting_teams  mt ON mt.meeting_id = m.id
      LEFT JOIN users u           ON u.id = $1
      WHERE m.id = $2
        AND (
          mm.user_id = $1
          OR m.invitee_user_id = $1
          OR (u.team_id IS NOT NULL AND mt.team_id = u.team_id)
        )
      LIMIT 1
      `,
      [req.user.id, meetingId]
    );

    if (accessResult.rowCount === 0) {
      return res.status(403).json({ error: 'You are not invited to this meeting' });
    }

    // Mark as live (optional)
    await pool.query(
      `UPDATE meetings
       SET status = 'live', updated_at = NOW()
       WHERE id = $1 AND status = 'scheduled'`,
      [meetingId]
    );

    const joinUrl = meeting.meeting_link
      ? `${meeting.meeting_link}${meeting.meeting_link.includes('?') ? '&' : '?'}token=demo-${req.user.id}`
      : null;

    return res.json({
      meetingId: meeting.id,
      title: meeting.title,
      joinUrl,
      status: 'joined',
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getUpcomingMeetings, joinMeeting };