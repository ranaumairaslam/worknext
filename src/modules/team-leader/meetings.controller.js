const pool = require("../../config/db");

/*
|--------------------------------------------------------------------------
| GET TEAM
|--------------------------------------------------------------------------
*/

async function getLeaderTeam(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      t.id,
      t.name,
      t.description,
      t.company_id,
      t.leader_id,
      c.name AS company_name
    FROM teams t
    LEFT JOIN companies c
      ON c.id = t.company_id
    WHERE t.leader_id = $1
    LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}


/*
|--------------------------------------------------------------------------
| CREATE MEETING
|--------------------------------------------------------------------------
| POST /api/team-leader/meetings
|--------------------------------------------------------------------------
*/

exports.createMeeting = async (req, res) => {
  const client = await pool.connect();

  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found for this Team Leader",
      });
    }

    const {
      title,
      description,
      projectId,
      date,
      time,
      meetingLink,
      platform = "Google Meet",
      participantIds = [],
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: "Meeting title is required",
      });
    }

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "Meeting date is required",
      });
    }

    if (!time) {
      return res.status(400).json({
        success: false,
        message: "Meeting time is required",
      });
    }

    if (projectId) {
      const project = await client.query(
        `
        SELECT id
        FROM projects
        WHERE id = $1
          AND team_id = $2
        LIMIT 1
        `,
        [projectId, team.id]
      );

      if (!project.rowCount) {
        return res.status(404).json({
          success: false,
          message: "Project not found in your team",
        });
      }
    }

    const ids = Array.isArray(participantIds)
      ? [...new Set(participantIds.map(Number).filter(Number.isInteger))]
      : [];

    if (ids.length > 0) {
      const members = await client.query(
        `
        SELECT id
        FROM users
        WHERE id = ANY($1::int[])
          AND team_id = $2
          AND company_id = $3
        `,
        [ids, team.id, team.company_id]
      );

      const validIds = members.rows.map((row) => row.id);
      const invalidIds = ids.filter((id) => !validIds.includes(id));

      if (invalidIds.length > 0) {
        return res.status(400).json({
          success: false,
          message: "One or more participants do not belong to your team",
          invalidParticipantIds: invalidIds,
        });
      }
    }

    await client.query("BEGIN");

    const scheduledAt = new Date(`${String(date).slice(0, 10)}T${String(time).slice(0, 5)}:00`);

    const meetingResult = await client.query(
      `
      INSERT INTO meetings (
        title,
        description,
        company_id,
        project_id,
        created_by,
        scheduled_date,
        scheduled_time,
        scheduled_at,
        meeting_link,
        mode,
        status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled', NOW(), NOW())
      RETURNING *
      `,
      [
        String(title).trim(),
        description ? String(description).trim() : null,
        team.company_id,
        projectId || null,
        req.user.id,
        date,
        time,
        scheduledAt.toISOString(),
        meetingLink || null,
        platform || "Google Meet",
      ]
    );

    const meeting = meetingResult.rows[0];

    if (ids.length > 0) {
      for (const userId of ids) {
        await client.query(
          `
          INSERT INTO meeting_members (meeting_id, user_id)
          VALUES ($1, $2)
          ON CONFLICT (meeting_id, user_id) DO NOTHING
          `,
          [meeting.id, userId]
        );
      }
    }

    await client.query("COMMIT");

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.description,
        m.scheduled_date,
        m.scheduled_time,
        m.meeting_link,
        m.mode AS platform,
        m.status,
        m.created_at,
        p.id AS project_id,
        p.name AS project_name,
        organizer.id AS organizer_id,
        organizer.name AS organizer_name,
        organizer.role AS organizer_role
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      LEFT JOIN users organizer ON organizer.id = m.created_by
      WHERE m.id = $1
      `,
      [meeting.id]
    );

    return res.status(201).json({
      success: true,
      message: "Meeting scheduled successfully",
      data: {
        ...rows[0],
        participants: ids,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error("❌ createMeeting:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to schedule meeting",
    });
  } finally {
    client.release();
  }
};


/*
|--------------------------------------------------------------------------
| GET ALL TEAM MEETINGS
|--------------------------------------------------------------------------
| GET /api/team-leader/meetings
|--------------------------------------------------------------------------
|
| This returns:
|
| 1. Meetings created by Company Admin for this team
| 2. Meetings created by this Team Leader
|
|--------------------------------------------------------------------------
*/

exports.getMeetings = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const { status, search, upcoming } = req.query;

    const conditions = [
      `m.company_id = $1`,
      `(
        EXISTS (
          SELECT 1 FROM projects p2
          WHERE p2.id = m.project_id AND p2.team_id = $2
        )
        OR EXISTS (
          SELECT 1 FROM meeting_members mm2
          JOIN users u2 ON u2.id = mm2.user_id
          WHERE mm2.meeting_id = m.id AND u2.team_id = $2
        )
      )`,
    ];

    const values = [team.company_id, team.id];

    let index = 3;

    if (status) {
      conditions.push(`LOWER(m.status) = LOWER($${index})`);
      values.push(status);
      index++;
    }

    if (search && String(search).trim()) {
      conditions.push(`(
        m.title ILIKE $${index}
        OR p.name ILIKE $${index}
        OR organizer.name ILIKE $${index}
      )`);
      values.push(`%${String(search).trim()}%`);
      index++;
    }

    if (String(upcoming).toLowerCase() === "true") {
      conditions.push(`COALESCE(m.scheduled_at, (m.scheduled_date + m.scheduled_time)) >= NOW()`);
    }

    const query = `
      SELECT
        m.id,
        m.title,
        m.description,
        m.scheduled_date,
        m.scheduled_time,
        m.meeting_link,
        m.mode AS platform,
        m.status,
        m.created_at,
        m.updated_at,
        p.id AS project_id,
        p.name AS project_name,
        organizer.id AS organizer_id,
        organizer.name AS organizer_name,
        organizer.role AS organizer_role,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', participant.id,
              'name', participant.name,
              'email', participant.email,
              'role', participant.role
            )
          ) FILTER (WHERE participant.id IS NOT NULL),
          '[]'
        ) AS participants
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      LEFT JOIN users organizer ON organizer.id = m.created_by
      LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
      LEFT JOIN users participant ON participant.id = mm.user_id
      WHERE ${conditions.join(" AND ")}
      GROUP BY
        m.id,
        p.id,
        p.name,
        organizer.id,
        organizer.name,
        organizer.role
      ORDER BY m.scheduled_date ASC, m.scheduled_time ASC
    `;

    const { rows } = await pool.query(query, values);

    return res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("❌ getMeetings:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load meetings",
    });
  }
};


/*
|--------------------------------------------------------------------------
| GET SINGLE MEETING
|--------------------------------------------------------------------------
| GET /api/team-leader/meetings/:meetingId
|--------------------------------------------------------------------------
*/

exports.getMeetingById = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const { meetingId } = req.params;

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.description,
        m.scheduled_date,
        m.scheduled_time,
        m.meeting_link,
        m.mode AS platform,
        m.status,
        m.created_at,
        m.updated_at,
        p.id AS project_id,
        p.name AS project_name,
        organizer.id AS organizer_id,
        organizer.name AS organizer_name,
        organizer.role AS organizer_role,
        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', participant.id,
              'name', participant.name,
              'email', participant.email,
              'role', participant.role
            )
          ) FILTER (WHERE participant.id IS NOT NULL),
          '[]'
        ) AS participants
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      LEFT JOIN users organizer ON organizer.id = m.created_by
      LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
      LEFT JOIN users participant ON participant.id = mm.user_id
      WHERE m.id = $1
        AND m.company_id = $2
        AND (
          EXISTS (
            SELECT 1 FROM projects p2
            WHERE p2.id = m.project_id AND p2.team_id = $3
          )
          OR EXISTS (
            SELECT 1 FROM meeting_members mm2
            JOIN users u2 ON u2.id = mm2.user_id
            WHERE mm2.meeting_id = m.id AND u2.team_id = $3
          )
        )
      GROUP BY m.id, p.id, p.name, organizer.id, organizer.name, organizer.role
      LIMIT 1
      `,
      [meetingId, team.company_id, team.id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found",
      });
    }

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("❌ getMeetingById:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load meeting",
    });
  }
};


/*
|--------------------------------------------------------------------------
| CANCEL MEETING
|--------------------------------------------------------------------------
| PATCH /api/team-leader/meetings/:meetingId/cancel
|--------------------------------------------------------------------------
*/

exports.cancelMeeting = async (req, res) => {
  try {
    const team = await getLeaderTeam(req.user.id);

    if (!team) {
      return res.status(404).json({
        success: false,
        message: "No team found",
      });
    }

    const { meetingId } = req.params;

    const { rows } = await pool.query(
      `
      UPDATE meetings
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
        AND company_id = $2
        AND created_by = $3
        AND (
          EXISTS (
            SELECT 1 FROM projects p2
            WHERE p2.id = meetings.project_id AND p2.team_id = $4
          )
          OR EXISTS (
            SELECT 1 FROM meeting_members mm2
            JOIN users u2 ON u2.id = mm2.user_id
            WHERE mm2.meeting_id = meetings.id AND u2.team_id = $4
          )
        )
      RETURNING *
      `,
      [meetingId, team.company_id, req.user.id, team.id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Meeting not found or you are not the organizer",
      });
    }

    return res.json({
      success: true,
      message: "Meeting cancelled successfully",
      data: rows[0],
    });
  } catch (error) {
    console.error("❌ cancelMeeting:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to cancel meeting",
    });
  }
};


/*
|--------------------------------------------------------------------------
| GET UPCOMING MEETINGS
|--------------------------------------------------------------------------
| GET /api/team-leader/meetings/upcoming
|--------------------------------------------------------------------------
*/

exports.getUpcomingMeetings = async (
  req,
  res
) => {

  req.query.upcoming = "true";

  return exports.getMeetings(
    req,
    res
  );
};