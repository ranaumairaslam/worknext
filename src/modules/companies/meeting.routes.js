const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

// Known platforms get canonical names; any other non-empty string is allowed.
const KNOWN_MEETING_SOURCES = {
  "google meet": "Google Meet",
  googlemeet: "Google Meet",
  "google-meet": "Google Meet",
  zoom: "Zoom",
};
const ALLOWED_STATUSES = ["scheduled", "completed", "cancelled", "live"];
const COLLECTION_METHODS = ["GET", "POST"];
const ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

/** toWhom / toWhome audience types */
const TO_WHOM_TYPES = ["Team Meeting", "Client", "Project Leader"];

function normalizeToWhome(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const key = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  const compact = key.replace(/\s+/g, "");
  const map = {
    "team meeting": "Team Meeting",
    teammeeting: "Team Meeting",
    client: "Client",
    "project leader": "Project Leader",
    projectleader: "Project Leader",
    "project lead": "Project Leader",
    projectlead: "Project Leader",
    // legacy aliases ΓåÆ Project Leader
    "team leads": "Project Leader",
    "team lead": "Project Leader",
    teamleads: "Project Leader",
    teamlead: "Project Leader",
    leads: "Project Leader",
  };
  return map[key] || map[compact] || null;
}

function normalizeMeetingSource(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const trimmed = String(value).trim();
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (KNOWN_MEETING_SOURCES[key]) return KNOWN_MEETING_SOURCES[key];
  // compact key without spaces (e.g. googlemeet)
  const compact = key.replace(/\s+/g, "");
  if (KNOWN_MEETING_SOURCES[compact]) return KNOWN_MEETING_SOURCES[compact];
  // another platform ΓÇö keep user-provided label
  return trimmed;
}

const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: "You do not have access to this resource",
      });
    }
    next();
  };

const methodNotAllowed = (allowed) => (req, res) => {
  res.set("Allow", allowed.join(", "));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(", ")}`,
  });
};

const sendError = (res, status, message, errors = null) => {
  const payload = { success: false, code: status, message };
  if (errors) payload.errors = errors;
  return res.status(status).json(payload);
};

const parseMeetingId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:meetingId[:/])?(\d+)$/i);
  if (!matched) return null;
  const id = Number.parseInt(matched[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function loadCompany(req, res, next) {
  if (req.company) return next();
  try {
    const userResult = await pool.query(
      "SELECT company_id FROM users WHERE id = $1",
      [req.user.id],
    );
    const companyId = userResult.rows[0]?.company_id || req.user.companyId;
    if (!companyId) {
      return sendError(res, 403, "User does not belong to a company");
    }
    req.company = { id: companyId };
    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCompany);

const canManage = authorizeRole("company", "super_admin", "team_leader");

// Forward declaration ΓÇö assigned after listMeetingsHandler is defined
let listMeetingsHandler = async (req, res) => {
  return sendError(res, 500, "Meetings list handler not ready");
};

// Early aliases so Postman paths always resolve (before /:meetingId)
router.get("/list", (req, res, next) => listMeetingsHandler(req, res, next));
router.post("/list", (req, res, next) =>
  listMeetingsHandler(req, res, next, { requireToWhom: true }),
);
router.post("/get", (req, res, next) =>
  listMeetingsHandler(req, res, next, { requireToWhom: true }),
);
router.get("/get", (req, res, next) => listMeetingsHandler(req, res, next));
router.post("/filter", (req, res, next) =>
  listMeetingsHandler(req, res, next, { requireToWhom: true }),
);
router.post("/filter/", (req, res, next) =>
  listMeetingsHandler(req, res, next, { requireToWhom: true }),
);
router.all("/list", methodNotAllowed(["GET", "POST"]));
router.all("/get", methodNotAllowed(["GET", "POST"]));
router.all("/filter", methodNotAllowed(["POST"]));
router.all("/filter/", methodNotAllowed(["POST"]));

function pickMeetingBody(body = {}) {
  const teamsRaw =
    body.Teams ?? body.teams ?? body.selectTeams ?? body.TeamIds ?? body.teamIds;

  return {
    title: body.Title ?? body.title ?? null,
    toWhome: body.toWhome ?? body.toWhom ?? body.ToWhome ?? body.to_whom ?? null,
    projectName: body.ProjectName ?? body.projectName ?? null,
    projectId: body.projectId ?? body.ProjectId ?? null,
    date: body.date ?? body.Date ?? null,
    time: body.time ?? body.Time ?? null,
    meetingSource:
      body.MeetingSource ?? body.meetingSource ?? body.Mode ?? body.mode ?? null,
    meetingLink: body.MeetingLink ?? body.meetingLink ?? body.meeting_link ?? null,
    teams: teamsRaw,
    clientName: body.ClientName ?? body.clientName ?? body.client ?? null,
    clientId: body.clientId ?? body.ClientId ?? null,
    status: body.status ?? body.Status ?? null,
    description: body.description ?? body.Description ?? null,
  };
}

function normalizeTime(time) {
  if (time === null || time === undefined || String(time).trim() === "") {
    return null;
  }
  const value = String(time).trim();
  if (/^\d{1,2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(value)) return value;
  return null;
}

function normalizeDate(date) {
  if (date === null || date === undefined || String(date).trim() === "") {
    return null;
  }
  const value = String(date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function buildScheduledAt(date, time) {
  if (!date) return null;
  const t = time || "00:00:00";
  return new Date(`${date}T${t}`);
}

function normalizeTeamsInput(teams) {
  if (teams === null || teams === undefined || teams === "") return [];
  if (Array.isArray(teams)) return teams;
  if (typeof teams === "string") {
    return teams
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [teams];
}

async function resolveProject(db, companyId, { projectName, projectId }) {
  if (projectId !== null && projectId !== undefined && String(projectId).trim() !== "") {
    const id = Number.parseInt(projectId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: { field: "projectId", message: "Invalid projectId" } };
    }
    const { rows } = await db.query(
      `SELECT id, name FROM projects WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!rows[0]) {
      return { error: { field: "projectId", message: "Project not found" } };
    }
    return { project: rows[0] };
  }

  if (projectName && String(projectName).trim()) {
    const name = String(projectName).trim();
    const { rows } = await db.query(
      `SELECT id, name FROM projects
       WHERE company_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [companyId, name],
    );
    if (!rows[0]) {
      return {
        error: {
          field: "ProjectName",
          message: `Project "${name}" not found`,
        },
      };
    }
    return { project: rows[0] };
  }

  return { project: null };
}

async function resolveTeams(db, companyId, teamsInput) {
  const items = normalizeTeamsInput(teamsInput);
  if (!items.length) return { teams: [] };

  const resolved = [];
  const errors = [];

  for (const item of items) {
    if (item === null || item === undefined || String(item).trim() === "") continue;

    const asNumber = Number.parseInt(item, 10);
    if (Number.isInteger(asNumber) && String(asNumber) === String(item).trim()) {
      const { rows } = await db.query(
        `SELECT id, name FROM teams WHERE id = $1 AND company_id = $2`,
        [asNumber, companyId],
      );
      if (!rows[0]) {
        errors.push({
          field: "Teams",
          message: `Team id ${asNumber} not found`,
        });
        continue;
      }
      resolved.push(rows[0]);
      continue;
    }

    const name = String(item).trim();
    const { rows } = await db.query(
      `SELECT id, name FROM teams
       WHERE company_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [companyId, name],
    );
    if (!rows[0]) {
      errors.push({
        field: "Teams",
        message: `Team "${name}" not found`,
      });
      continue;
    }
    resolved.push(rows[0]);
  }

  if (errors.length) return { errors };

  // unique by id
  const unique = [];
  const seen = new Set();
  for (const team of resolved) {
    if (seen.has(team.id)) continue;
    seen.add(team.id);
    unique.push(team);
  }
  return { teams: unique };
}

async function resolveClientTarget(db, companyId, data = {}) {
  if (
    data.clientId !== null &&
    data.clientId !== undefined &&
    String(data.clientId).trim() !== ""
  ) {
    const id = Number.parseInt(data.clientId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: { field: "clientId", message: "Invalid clientId" } };
    }
    const { rows } = await db.query(
      `SELECT id, name, email, company_name, user_id
       FROM clients WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!rows[0]) {
      return { error: { field: "clientId", message: "Client not found" } };
    }
    return { client: rows[0] };
  }

  const name = String(data.clientName || "").trim();
  if (!name) {
    return {
      error: {
        field: "ClientName",
        message: 'ClientName is required when toWhome is "Client"',
      },
    };
  }

  const { rows } = await db.query(
    `SELECT c.id, c.name, c.email, c.company_name, c.user_id
     FROM clients c
     LEFT JOIN users u ON u.id = c.user_id
     WHERE c.company_id = $1
       AND (
         LOWER(c.name) = LOWER($2)
         OR LOWER(COALESCE(c.email, '')) = LOWER($2)
         OR LOWER(COALESCE(c.company_name, '')) = LOWER($2)
         OR LOWER(COALESCE(c.account_owner_name, '')) = LOWER($2)
         OR LOWER(COALESCE(u.name, '')) = LOWER($2)
       )
     ORDER BY c.id DESC
     LIMIT 1`,
    [companyId, name],
  );
  if (!rows[0]) {
    return {
      error: {
        field: "ClientName",
        message: `Client "${name}" not found`,
      },
    };
  }
  return { client: rows[0] };
}

async function fetchTeamMembers(db, companyId, teams) {
  if (!teams.length) return [];
  const teamIds = teams.map((t) => t.id);
  const { rows } = await db.query(
    `SELECT id, name, email, role, team_id
     FROM users
     WHERE company_id = $1
       AND team_id = ANY($2::int[])
     ORDER BY name ASC`,
    [companyId, teamIds],
  );
  return rows;
}

async function fetchProjectLeader(db, companyId, projectId) {
  if (!projectId) return null;
  const { rows } = await db.query(
    `
    SELECT u.id, u.name, u.email, u.role, u.team_id
    FROM projects p
    JOIN users u ON u.id = p.project_leader_id
    WHERE p.id = $1
      AND p.company_id = $2
      AND u.company_id = $2
    LIMIT 1
    `,
    [projectId, companyId],
  );
  return rows[0] || null;
}

/**
 * Link teams to meeting and invite by audience:
 * - Team Meeting    ΓåÆ all team members
 * - Project Leader  ΓåÆ teams linked only (leader invited separately)
 * - Client          ΓåÆ teams optional (client invited separately)
 */
async function attachTeamsWithMembers(
  db,
  companyId,
  meetingId,
  teams,
  { replace = false, audience = "Team Meeting" } = {},
) {
  if (replace) {
    const previous = await db.query(
      `SELECT team_id FROM meeting_teams WHERE meeting_id = $1`,
      [meetingId],
    );
    const previousIds = previous.rows.map((r) => r.team_id);

    await db.query(`DELETE FROM meeting_teams WHERE meeting_id = $1`, [meetingId]);

    if (previousIds.length && audience === "Team Meeting") {
      await db.query(
        `
        DELETE FROM meeting_members mm
        USING users u
        WHERE mm.meeting_id = $1
          AND mm.user_id = u.id
          AND u.company_id = $2
          AND u.team_id = ANY($3::int[])
        `,
        [meetingId, companyId, previousIds],
      );
    }
  }

  for (const team of teams) {
    await db.query(
      `INSERT INTO meeting_teams (meeting_id, team_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [meetingId, team.id],
    );
  }

  // Only Team Meeting auto-invites team members from Teams
  if (audience !== "Team Meeting") {
    return [];
  }

  const members = await fetchTeamMembers(db, companyId, teams);
  await addMeetingMembers(db, meetingId, members);
  return members;
}

async function removeTeamsWithMembers(db, companyId, meetingId, teams) {
  const teamIds = teams.map((t) => t.id);
  if (!teamIds.length) return;

  await db.query(
    `DELETE FROM meeting_teams
     WHERE meeting_id = $1 AND team_id = ANY($2::int[])`,
    [meetingId, teamIds],
  );

  // Remove members that belong to removed teams and are no longer covered
  // by any remaining invited team on this meeting
  await db.query(
    `
    DELETE FROM meeting_members mm
    USING users u
    WHERE mm.meeting_id = $1
      AND mm.user_id = u.id
      AND u.company_id = $2
      AND u.team_id = ANY($3::int[])
      AND NOT EXISTS (
        SELECT 1
        FROM meeting_teams mt
        WHERE mt.meeting_id = $1
          AND mt.team_id = u.team_id
      )
    `,
    [meetingId, companyId, teamIds],
  );
}

async function replaceMeetingTeams(db, companyId, meetingId, teams, audience) {
  return attachTeamsWithMembers(db, companyId, meetingId, teams, {
    replace: true,
    audience,
  });
}

async function addMeetingTeams(db, companyId, meetingId, teams, audience) {
  return attachTeamsWithMembers(db, companyId, meetingId, teams, {
    replace: false,
    audience,
  });
}

async function resolveMembers(db, companyId, membersInput) {
  const items = normalizeTeamsInput(membersInput);
  if (!items.length) return { members: [] };

  const resolved = [];
  const errors = [];

  for (const item of items) {
    if (item === null || item === undefined || String(item).trim() === "") continue;

    const asNumber = Number.parseInt(item, 10);
    if (Number.isInteger(asNumber) && String(asNumber) === String(item).trim()) {
      const { rows } = await db.query(
        `SELECT id, name, email, role FROM users
         WHERE id = $1 AND company_id = $2`,
        [asNumber, companyId],
      );
      if (!rows[0]) {
        errors.push({
          field: "Members",
          message: `Member id ${asNumber} not found`,
        });
        continue;
      }
      resolved.push(rows[0]);
      continue;
    }

    const name = String(item).trim();
    const { rows } = await db.query(
      `SELECT id, name, email, role FROM users
       WHERE company_id = $1
         AND (LOWER(name) = LOWER($2) OR LOWER(email) = LOWER($2))
       LIMIT 1`,
      [companyId, name],
    );
    if (!rows[0]) {
      errors.push({
        field: "Members",
        message: `Member "${name}" not found`,
      });
      continue;
    }
    resolved.push(rows[0]);
  }

  if (errors.length) return { errors };

  const unique = [];
  const seen = new Set();
  for (const member of resolved) {
    if (seen.has(member.id)) continue;
    seen.add(member.id);
    unique.push(member);
  }
  return { members: unique };
}

async function addMeetingMembers(db, meetingId, members) {
  for (const member of members) {
    await db.query(
      `INSERT INTO meeting_members (meeting_id, user_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [meetingId, member.id],
    );
  }
}

async function fetchMeetingById(companyId, meetingId) {
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.title AS "Title",
      m.to_whom AS "toWhom",
      m.to_whom AS "toWhome",
      m.invitee_user_id,
      m.project_id,
      p.name AS "ProjectName",
      m.scheduled_date AS date,
      TO_CHAR(m.scheduled_time, 'HH24:MI') AS time,
      m.scheduled_at,
      m.mode AS "MeetingSource",
      m.meeting_link AS "MeetingLink",
      m.status,
      m.description,
      m.created_by,
      m.created_at,
      m.updated_at,
      (
        SELECT COALESCE(
          json_agg(
            jsonb_build_object(
              'id', t.id,
              'name', t.name,
              'members', (
                SELECT COALESCE(
                  json_agg(
                    jsonb_build_object(
                      'id', tm.id,
                      'name', tm.name,
                      'email', tm.email,
                      'role', tm.role
                    )
                    ORDER BY tm.name
                  ),
                  '[]'::json
                )
                FROM users tm
                WHERE tm.team_id = t.id
                  AND tm.company_id = m.company_id
              ),
              'memberCount', (
                SELECT COUNT(*)::int
                FROM users tm
                WHERE tm.team_id = t.id
                  AND tm.company_id = m.company_id
              )
            )
            ORDER BY t.name
          ),
          '[]'::json
        )
        FROM meeting_teams mt
        JOIN teams t ON t.id = mt.team_id
        WHERE mt.meeting_id = m.id
      ) AS "Teams",
      (
        SELECT COALESCE(
          json_agg(
            jsonb_build_object(
              'id', u.id,
              'name', u.name,
              'email', u.email,
              'role', u.role,
              'teamId', u.team_id,
              'teamName', tm.name
            )
            ORDER BY u.name
          ),
          '[]'::json
        )
        FROM meeting_members mm
        JOIN users u ON u.id = mm.user_id
        LEFT JOIN teams tm ON tm.id = u.team_id
        WHERE mm.meeting_id = m.id
      ) AS "Members"
    FROM meetings m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.id = $1 AND m.company_id = $2
    `,
    [meetingId, companyId],
  );
  return rows[0] || null;
}

function validateCreate(data) {
  const errors = [];
  if (!data.title || !String(data.title).trim()) {
    errors.push({ field: "Title", message: "Title is required" });
  }

  const toWhome = normalizeToWhome(data.toWhome);
  if (!toWhome) {
    errors.push({
      field: "toWhom",
      message: `toWhom must be one of: ${TO_WHOM_TYPES.join(", ")}`,
    });
  }

  const teams = normalizeTeamsInput(data.teams);
  if (toWhome === "Team Meeting" && !teams.length) {
    errors.push({
      field: "Teams",
      message: 'Teams is required when toWhom is "Team Meeting"',
    });
  }

  if (toWhome === "Client") {
    const hasClient =
      (data.clientName && String(data.clientName).trim()) ||
      (data.clientId !== null &&
        data.clientId !== undefined &&
        String(data.clientId).trim() !== "");
    if (!hasClient) {
      errors.push({
        field: "ClientName",
        message: 'ClientName (or clientId) is required when toWhom is "Client"',
      });
    }
  }

  if (
    (!data.projectName || !String(data.projectName).trim()) &&
    (data.projectId === null || data.projectId === undefined || data.projectId === "")
  ) {
    errors.push({
      field: "ProjectName",
      message: "ProjectName (or projectId) is required",
    });
  }
  const date = normalizeDate(data.date);
  if (!date) {
    errors.push({
      field: "date",
      message: "date is required (YYYY-MM-DD)",
    });
  }
  const time = normalizeTime(data.time);
  if (!data.time || !String(data.time).trim()) {
    errors.push({ field: "time", message: "time is required (HH:MM)" });
  } else if (!time) {
    errors.push({ field: "time", message: "time must be HH:MM or HH:MM:SS" });
  }
  const meetingSource = normalizeMeetingSource(data.meetingSource);
  if (!meetingSource) {
    errors.push({
      field: "MeetingSource",
      message:
        'MeetingSource is required (e.g. "Google Meet", "Zoom", or another platform)',
    });
  }
  if (
    (meetingSource === "Google Meet" || meetingSource === "Zoom") &&
    (!data.meetingLink || !String(data.meetingLink).trim())
  ) {
    errors.push({
      field: "MeetingLink",
      message: "MeetingLink is required for Google Meet and Zoom",
    });
  }
  return { errors, date, time, meetingSource, toWhome };
}

// =====================================================
// CREATE
// POST /api/company/meetings
// POST /api/company/scheduledMeetings
// =====================================================
async function createMeetingHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const data = pickMeetingBody(req.body || {});
    const { errors, date, time, meetingSource, toWhome } = validateCreate(data);
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    await db.query("BEGIN");

    const projectResult = await resolveProject(db, req.company.id, data);
    if (projectResult.error) {
      await db.query("ROLLBACK");
      return sendError(res, 404, projectResult.error.message, [projectResult.error]);
    }

    const teamsResult = await resolveTeams(db, req.company.id, data.teams);
    if (teamsResult.errors) {
      await db.query("ROLLBACK");
      return sendError(res, 404, "One or more teams not found", teamsResult.errors);
    }

    let clientId = null;
    let inviteeUserId = null;
    let clientUserInvite = null;
    let projectLeaderInvite = null;

    if (toWhome === "Client") {
      const clientResult = await resolveClientTarget(db, req.company.id, data);
      if (clientResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, clientResult.error.message, [
          clientResult.error,
        ]);
      }
      clientId = clientResult.client.id;
      if (clientResult.client.user_id) {
        clientUserInvite = {
          id: clientResult.client.user_id,
          name: clientResult.client.name,
          email: clientResult.client.email,
        };
        inviteeUserId = clientResult.client.user_id;
      }
    }

    if (toWhome === "Project Leader") {
      projectLeaderInvite = await fetchProjectLeader(
        db,
        req.company.id,
        projectResult.project.id,
      );
      if (!projectLeaderInvite) {
        await db.query("ROLLBACK");
        return sendError(
          res,
          404,
          "Project Leader not found for this project",
          [
            {
              field: "toWhom",
              message:
                "Assign a project leader to the project before scheduling this meeting",
            },
          ],
        );
      }
      inviteeUserId = projectLeaderInvite.id;
    }

    const scheduledAt = buildScheduledAt(date, time);

    const { rows } = await db.query(
      `
      INSERT INTO meetings (
        company_id, title, to_whom, invitee_user_id, client_id, project_id,
        scheduled_date, scheduled_time, scheduled_at,
        mode, meeting_link, status, description, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled',$12,$13)
      RETURNING id
      `,
      [
        req.company.id,
        String(data.title).trim(),
        toWhome,
        inviteeUserId,
        clientId,
        projectResult.project?.id || null,
        date,
        time,
        scheduledAt,
        meetingSource,
        data.meetingLink ? String(data.meetingLink).trim() : null,
        data.description ? String(data.description).trim() : null,
        req.user.id,
      ],
    );

    const meetingId = rows[0].id;

    // Audience-based invites
    if (toWhome === "Team Meeting") {
      await replaceMeetingTeams(
        db,
        req.company.id,
        meetingId,
        teamsResult.teams,
        "Team Meeting",
      );
    } else if (toWhome === "Project Leader") {
      if (teamsResult.teams.length) {
        await replaceMeetingTeams(
          db,
          req.company.id,
          meetingId,
          teamsResult.teams,
          "Project Leader",
        );
      }
      await addMeetingMembers(db, meetingId, [projectLeaderInvite]);
    } else if (toWhome === "Client") {
      // Optional teams can be linked, but only the client is invited
      if (teamsResult.teams.length) {
        await replaceMeetingTeams(
          db,
          req.company.id,
          meetingId,
          teamsResult.teams,
          "Client",
        );
      }
      if (clientUserInvite) {
        await addMeetingMembers(db, meetingId, [clientUserInvite]);
      }
    }

    await db.query("COMMIT");

    const meeting = await fetchMeetingById(req.company.id, meetingId);
    return res.status(201).json({
      success: true,
      code: 201,
      message: "Meeting scheduled successfully",
      data: meeting,
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    db.release();
  }
}

router.post("/", canManage, createMeetingHandler);
router.post("/create", canManage, createMeetingHandler);
router.all("/create", methodNotAllowed(["POST"]));

// =====================================================
// LIST + GET ONE
// Filter by toWhom: Team Meeting | Client | Project Leader
// GET  /api/company/scheduledMeetings?toWhom=Client
// POST /api/company/scheduledMeetings/filter  { "toWhom": "Client" }
// =====================================================
listMeetingsHandler = async function listMeetingsHandler(
  req,
  res,
  next,
  { requireToWhom = false } = {},
) {
  try {
    const rawToWhom =
      req.body?.toWhom ??
      req.body?.toWhome ??
      req.query.toWhom ??
      req.query.toWhome ??
      null;

    let toWhom = null;
    if (rawToWhom !== null && rawToWhom !== undefined && String(rawToWhom).trim() !== "") {
      toWhom = normalizeToWhome(rawToWhom);
      if (!toWhom) {
        return sendError(res, 400, "Invalid toWhom", [
          {
            field: "toWhom",
            message: `toWhom must be one of: ${TO_WHOM_TYPES.join(", ")}`,
          },
        ]);
      }
    } else if (requireToWhom) {
      return sendError(res, 400, "toWhom is required", [
        {
          field: "toWhom",
          message: `Pass toWhom: ${TO_WHOM_TYPES.join(" | ")}`,
        },
      ]);
    }

    const status = ALLOWED_STATUSES.includes(
      String(req.query.status || req.body?.status || "").toLowerCase(),
    )
      ? String(req.query.status || req.body?.status).toLowerCase()
      : null;

    const values = [req.company.id];
    const clauses = ["m.company_id = $1"];

    if (status) {
      values.push(status);
      clauses.push(`m.status = $${values.length}`);
    }

    if (toWhom) {
      if (toWhom === "Project Leader") {
        values.push("Project Leader", "Team Leads", "Team Lead");
        clauses.push(
          `(m.to_whom = $${values.length - 2} OR m.to_whom = $${values.length - 1} OR m.to_whom = $${values.length})`,
        );
      } else {
        values.push(toWhom);
        clauses.push(`m.to_whom = $${values.length}`);
      }
    }

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.title AS "Title",
        m.to_whom AS "toWhom",
        m.to_whom AS "toWhome",
        m.invitee_user_id,
        m.project_id,
        p.name AS "ProjectName",
        m.scheduled_date AS date,
        TO_CHAR(m.scheduled_time, 'HH24:MI') AS time,
        m.scheduled_at,
        m.mode AS "MeetingSource",
        m.meeting_link AS "MeetingLink",
        m.status,
        m.description,
        m.created_at,
        m.updated_at,
        (
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'memberCount', (
                  SELECT COUNT(*)::int
                  FROM users tm
                  WHERE tm.team_id = t.id AND tm.company_id = m.company_id
                ),
                'members', (
                  SELECT COALESCE(
                    json_agg(
                      jsonb_build_object(
                        'id', tm.id,
                        'name', tm.name,
                        'email', tm.email,
                        'role', tm.role
                      )
                      ORDER BY tm.name
                    ),
                    '[]'::json
                  )
                  FROM users tm
                  WHERE tm.team_id = t.id AND tm.company_id = m.company_id
                )
              )
              ORDER BY t.name
            ),
            '[]'::json
          )
          FROM meeting_teams mt
          JOIN teams t ON t.id = mt.team_id
          WHERE mt.meeting_id = m.id
        ) AS "Teams",
        (
          SELECT COALESCE(
            json_agg(
              jsonb_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'teamId', u.team_id
              )
              ORDER BY u.name
            ),
            '[]'::json
          )
          FROM meeting_members mm
          JOIN users u ON u.id = mm.user_id
          WHERE mm.meeting_id = m.id
        ) AS "Members"
      FROM meetings m
      LEFT JOIN projects p ON p.id = m.project_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY m.scheduled_at ASC NULLS LAST, m.created_at DESC
      `,
      values,
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: toWhom
        ? `Meetings for toWhom="${toWhom}" fetched successfully`
        : "Meetings fetched successfully",
      toWhom: toWhom || null,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
};

router.get("/", (req, res, next) => listMeetingsHandler(req, res, next));

async function getMeetingHandler(req, res, next) {
  try {
    const meetingId = parseMeetingId(req.params.meetingId);
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id", [
        {
          field: "meetingId",
          message: "Use /meetings/12 or /meetings/meetingId:12",
        },
      ]);
    }

    const meeting = await fetchMeetingById(req.company.id, meetingId);
    if (!meeting) return sendError(res, 404, "Meeting not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Meeting fetched successfully",
      data: meeting,
    });
  } catch (error) {
    next(error);
  }
}

router.get("/meetingId/:meetingId", getMeetingHandler);
router.get("/:meetingId", getMeetingHandler);

// =====================================================
// PATCH / PUT
// =====================================================
async function updateMeetingHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const meetingId = parseMeetingId(req.params.meetingId);
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id");
    }

    const existing = await db.query(
      `SELECT id, to_whom, client_id FROM meetings WHERE id = $1 AND company_id = $2`,
      [meetingId, req.company.id],
    );
    if (!existing.rows[0]) {
      return sendError(res, 404, "Meeting not found");
    }

    const data = pickMeetingBody(req.body || {});
    const errors = [];

    let toWhome = undefined;
    if (data.toWhome !== null && data.toWhome !== undefined && data.toWhome !== "") {
      toWhome = normalizeToWhome(data.toWhome);
      if (!toWhome) {
        errors.push({
          field: "toWhom",
          message: `toWhom must be one of: ${TO_WHOM_TYPES.join(", ")}`,
        });
      }
    }
    const audience =
      toWhome ||
      normalizeToWhome(existing.rows[0].to_whom) ||
      "Team Meeting";

    let date = undefined;
    if (data.date !== null && data.date !== undefined && data.date !== "") {
      date = normalizeDate(data.date);
      if (!date) {
        errors.push({ field: "date", message: "date must be YYYY-MM-DD" });
      }
    }

    let time = undefined;
    if (data.time !== null && data.time !== undefined && data.time !== "") {
      time = normalizeTime(data.time);
      if (!time) {
        errors.push({ field: "time", message: "time must be HH:MM or HH:MM:SS" });
      }
    }

    let meetingSource = undefined;
    if (
      data.meetingSource !== null &&
      data.meetingSource !== undefined &&
      data.meetingSource !== ""
    ) {
      meetingSource = normalizeMeetingSource(data.meetingSource);
      if (!meetingSource) {
        errors.push({
          field: "MeetingSource",
          message:
            'MeetingSource must be "Google Meet", "Zoom", or another platform name',
        });
      }
    }

    if (
      meetingSource &&
      (meetingSource === "Google Meet" || meetingSource === "Zoom") &&
      data.meetingLink !== undefined &&
      (!data.meetingLink || !String(data.meetingLink).trim())
    ) {
      errors.push({
        field: "MeetingLink",
        message: "MeetingLink is required for Google Meet and Zoom",
      });
    }

    let status = undefined;
    if (data.status !== null && data.status !== undefined && data.status !== "") {
      status = String(data.status).trim().toLowerCase();
      if (!ALLOWED_STATUSES.includes(status)) {
        errors.push({
          field: "status",
          message: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        });
      }
    }

    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    await db.query("BEGIN");

    let projectId = undefined;
    if (
      (data.projectName && String(data.projectName).trim()) ||
      (data.projectId !== null && data.projectId !== undefined && data.projectId !== "")
    ) {
      const projectResult = await resolveProject(db, req.company.id, data);
      if (projectResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, projectResult.error.message, [
          projectResult.error,
        ]);
      }
      projectId = projectResult.project?.id || null;
    }

    let inviteeUserId = undefined;
    let clientId = undefined;
    const clientFieldsProvided =
      (data.clientName && String(data.clientName).trim()) ||
      (data.clientId !== null &&
        data.clientId !== undefined &&
        String(data.clientId).trim() !== "");

    if (audience === "Client" && (toWhome !== undefined || clientFieldsProvided)) {
      const clientResult = await resolveClientTarget(db, req.company.id, data);
      if (clientResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, clientResult.error.message, [
          clientResult.error,
        ]);
      }
      clientId = clientResult.client.id;
      inviteeUserId = clientResult.client.user_id || null;
      // Reset invites to only the client
      await db.query(`DELETE FROM meeting_members WHERE meeting_id = $1`, [
        meetingId,
      ]);
      if (inviteeUserId) {
        await addMeetingMembers(db, meetingId, [
          {
            id: inviteeUserId,
            name: clientResult.client.name,
            email: clientResult.client.email,
          },
        ]);
      }
    }

    if (audience === "Project Leader" && toWhome !== undefined) {
      const currentProject = await db.query(
        `SELECT project_id FROM meetings WHERE id = $1`,
        [meetingId],
      );
      const targetProjectId =
        projectId !== undefined
          ? projectId
          : currentProject.rows[0]?.project_id;
      const leader = await fetchProjectLeader(
        db,
        req.company.id,
        targetProjectId,
      );
      if (!leader) {
        await db.query("ROLLBACK");
        return sendError(
          res,
          404,
          "Project Leader not found for this project",
          [{ field: "toWhom", message: "Project has no assigned project leader" }],
        );
      }
      inviteeUserId = leader.id;
      await db.query(`DELETE FROM meeting_members WHERE meeting_id = $1`, [
        meetingId,
      ]);
      await addMeetingMembers(db, meetingId, [leader]);
    }

    const hasTeamsField =
      (req.body || {}).Teams !== undefined ||
      (req.body || {}).teams !== undefined ||
      (req.body || {}).selectTeams !== undefined ||
      (req.body || {}).TeamIds !== undefined ||
      (req.body || {}).teamIds !== undefined;

    if (hasTeamsField) {
      const teamsResult = await resolveTeams(db, req.company.id, data.teams);
      if (teamsResult.errors) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "One or more teams not found", teamsResult.errors);
      }
      if (audience === "Team Meeting" && !teamsResult.teams.length) {
        await db.query("ROLLBACK");
        return sendError(res, 400, 'Teams is required when toWhom is "Team Meeting"', [
          { field: "Teams", message: "select at least one team" },
        ]);
      }
      await replaceMeetingTeams(
        db,
        req.company.id,
        meetingId,
        teamsResult.teams,
        audience,
      );
    } else if (toWhome !== undefined && audience === "Team Meeting") {
      // Audience type changed ΓÇö re-apply invites for currently linked teams
      const linked = await db.query(
        `SELECT t.id, t.name
         FROM meeting_teams mt
         JOIN teams t ON t.id = mt.team_id
         WHERE mt.meeting_id = $1`,
        [meetingId],
      );
      if (linked.rows.length) {
        await replaceMeetingTeams(
          db,
          req.company.id,
          meetingId,
          linked.rows,
          audience,
        );
      }
    }

    // Recompute scheduled_at when date/time provided
    let scheduledAt = undefined;
    if (date !== undefined || time !== undefined) {
      const current = await db.query(
        `SELECT scheduled_date, scheduled_time FROM meetings WHERE id = $1`,
        [meetingId],
      );
      const nextDate =
        date !== undefined
          ? date
          : current.rows[0].scheduled_date
            ? String(current.rows[0].scheduled_date).slice(0, 10)
            : null;
      const nextTime =
        time !== undefined
          ? time
          : current.rows[0].scheduled_time
            ? String(current.rows[0].scheduled_time).slice(0, 8)
            : "00:00:00";
      scheduledAt = buildScheduledAt(nextDate, nextTime);
    }

    const title =
      data.title !== null && data.title !== undefined && data.title !== ""
        ? String(data.title).trim()
        : null;
    const meetingLink =
      data.meetingLink !== null && data.meetingLink !== undefined
        ? data.meetingLink === ""
          ? null
          : String(data.meetingLink).trim()
        : undefined;
    const description =
      data.description !== null && data.description !== undefined
        ? data.description === ""
          ? null
          : String(data.description).trim()
        : undefined;

    await db.query(
      `
      UPDATE meetings SET
        title = COALESCE($1, title),
        to_whom = COALESCE($2, to_whom),
        invitee_user_id = CASE WHEN $3::boolean THEN $4 ELSE invitee_user_id END,
        client_id = CASE WHEN $3::boolean THEN $5 ELSE client_id END,
        project_id = CASE WHEN $6::boolean THEN $7 ELSE project_id END,
        scheduled_date = COALESCE($8, scheduled_date),
        scheduled_time = COALESCE($9, scheduled_time),
        scheduled_at = COALESCE($10, scheduled_at),
        mode = COALESCE($11, mode),
        meeting_link = CASE WHEN $12::boolean THEN $13 ELSE meeting_link END,
        status = COALESCE($14, status),
        description = CASE WHEN $15::boolean THEN $16 ELSE description END,
        updated_at = NOW()
      WHERE id = $17 AND company_id = $18
      `,
      [
        title,
        toWhome ?? null,
        clientId !== undefined,
        inviteeUserId ?? null,
        clientId ?? null,
        projectId !== undefined,
        projectId ?? null,
        date ?? null,
        time ?? null,
        scheduledAt ?? null,
        meetingSource ?? null,
        meetingLink !== undefined,
        meetingLink ?? null,
        status ?? null,
        description !== undefined,
        description ?? null,
        meetingId,
        req.company.id,
      ],
    );

    await db.query("COMMIT");

    const meeting = await fetchMeetingById(req.company.id, meetingId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Meeting updated successfully",
      data: meeting,
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    db.release();
  }
}

// =====================================================
// EDIT
// PATCH/PUT /api/company/meetings/12
// PATCH/PUT /api/company/meetings/meetingId/12
// PATCH/PUT /api/company/meetings/edit/12
// PATCH/PUT /api/company/meetings/meetingId:12
// =====================================================
async function deleteMeetingHandler(req, res, next) {
  try {
    const meetingId = parseMeetingId(req.params.meetingId);
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id", [
        {
          field: "meetingId",
          message: "Use /meetings/12 or /meetings/delete/12",
        },
      ]);
    }

    const { rows } = await pool.query(
      `DELETE FROM meetings
       WHERE id = $1 AND company_id = $2
       RETURNING id, title`,
      [meetingId, req.company.id],
    );

    if (!rows[0]) return sendError(res, 404, "Meeting not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Meeting deleted successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

router.patch("/meetingId/:meetingId", canManage, updateMeetingHandler);
router.put("/meetingId/:meetingId", canManage, updateMeetingHandler);
router.delete("/meetingId/:meetingId", canManage, deleteMeetingHandler);
router.all(
  "/meetingId/:meetingId",
  methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]),
);

router.patch("/edit/:meetingId", canManage, updateMeetingHandler);
router.put("/edit/:meetingId", canManage, updateMeetingHandler);
router.post("/edit/:meetingId", canManage, updateMeetingHandler);
router.all("/edit/:meetingId", methodNotAllowed(["PUT", "PATCH", "POST"]));

// POST /api/company/meetings/edit  (meetingId in body)
router.post("/edit", canManage, async (req, res, next) => {
  const body = req.body || {};
  const meetingId = parseMeetingId(body.meetingId ?? body.MeetingId ?? body.id);
  if (!meetingId) {
    return sendError(res, 400, "meetingId is required", [
      { field: "meetingId", message: "Pass meetingId in body to edit" },
    ]);
  }
  req.params.meetingId = String(meetingId);
  return updateMeetingHandler(req, res, next);
});
router.all("/edit", methodNotAllowed(["POST"]));

// =====================================================
// INVITE member(s) and/or team(s) to a meeting
// POST /api/company/meetings/12/invite
// POST /api/company/meetings/invite/12
// POST /api/company/meetings/meetingId/12/invite
// Body: { "Members": ["hamza"], "Teams": ["Web Development"] }
//        or { "EmployeeName": "hamza", "TeamName": "SEO" }
// =====================================================
async function inviteToMeetingHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const meetingId = parseMeetingId(
      req.params.meetingId ?? (req.body || {}).meetingId ?? (req.body || {}).MeetingId,
    );
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id");
    }

    const meeting = await db.query(
      `SELECT id, to_whom, client_id FROM meetings WHERE id = $1 AND company_id = $2`,
      [meetingId, req.company.id],
    );
    if (!meeting.rows[0]) {
      return sendError(res, 404, "Meeting not found");
    }

    const audience =
      normalizeToWhome(meeting.rows[0].to_whom) || "Team Meeting";

    const body = req.body || {};
    const membersRaw =
      body.Members ??
      body.members ??
      body.EmployeeNames ??
      (body.EmployeeName || body.employeeName || body.MemberName
        ? [body.EmployeeName || body.employeeName || body.MemberName]
        : body.memberIds ?? body.MemberIds ?? null);

    const teamsRaw =
      body.Teams ??
      body.teams ??
      body.TeamNames ??
      (body.TeamName || body.teamName
        ? [body.TeamName || body.teamName]
        : body.TeamIds ?? body.teamIds ?? null);

    const hasMembers = membersRaw !== null && membersRaw !== undefined;
    const hasTeams = teamsRaw !== null && teamsRaw !== undefined;
    const hasClientInvite =
      audience === "Client" &&
      (body.ClientName !== undefined ||
        body.clientName !== undefined ||
        body.clientId !== undefined ||
        body.ClientId !== undefined);

    if (!hasMembers && !hasTeams && !hasClientInvite) {
      return sendError(res, 400, "Invite at least one member, team, or client", [
        {
          field: "Teams",
          message:
            audience === "Client"
              ? 'Provide ClientName, or Teams to link'
              : 'Provide Teams: ["teamName"] (invites follow toWhome rules)',
        },
      ]);
    }

    if (audience === "Client" && hasMembers) {
      return sendError(res, 400, 'Cannot invite team members when toWhome is "Client"', [
        {
          field: "toWhome",
          message: "Client meetings only invite the client",
        },
      ]);
    }

    await db.query("BEGIN");

    let invitedMembers = [];
    let invitedTeams = [];

    if (hasMembers && audience === "Team Meeting") {
      const membersResult = await resolveMembers(db, req.company.id, membersRaw);
      if (membersResult.errors) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "One or more members not found", membersResult.errors);
      }
      await addMeetingMembers(db, meetingId, membersResult.members);
      invitedMembers = membersResult.members;
    }

    if (hasMembers && audience === "Project Leader") {
      await db.query("ROLLBACK");
      return sendError(
        res,
        400,
        'Cannot invite arbitrary members when toWhom is "Project Leader"',
        [
          {
            field: "toWhom",
            message: "Project Leader meetings only invite the project leader",
          },
        ],
      );
    }

    if (hasClientInvite) {
      const clientResult = await resolveClientTarget(db, req.company.id, {
        clientName: body.ClientName ?? body.clientName,
        clientId: body.clientId ?? body.ClientId,
      });
      if (clientResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, clientResult.error.message, [
          clientResult.error,
        ]);
      }
      await db.query(
        `UPDATE meetings SET client_id = $1, invitee_user_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [
          clientResult.client.id,
          clientResult.client.user_id || null,
          meetingId,
        ],
      );
      if (clientResult.client.user_id) {
        const clientUser = {
          id: clientResult.client.user_id,
          name: clientResult.client.name,
          email: clientResult.client.email,
        };
        await addMeetingMembers(db, meetingId, [clientUser]);
        invitedMembers = [clientUser];
      }
    }

    let invitedFromTeams = [];
    if (hasTeams) {
      const teamsResult = await resolveTeams(db, req.company.id, teamsRaw);
      if (teamsResult.errors) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "One or more teams not found", teamsResult.errors);
      }
      invitedFromTeams = await addMeetingTeams(
        db,
        req.company.id,
        meetingId,
        teamsResult.teams,
        audience,
      );
      invitedTeams = teamsResult.teams;
    }

    await db.query("COMMIT");

    const full = await fetchMeetingById(req.company.id, meetingId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Invite sent successfully",
      invited: {
        Members: invitedMembers.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
        })),
        Teams: invitedTeams.map((t) => ({
          id: t.id,
          name: t.name,
          membersInvited: invitedFromTeams
            .filter((m) => m.team_id === t.id)
            .map((m) => ({ id: m.id, name: m.name, email: m.email })),
        })),
        TeamMembersAutoInvited: invitedFromTeams.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email,
          teamId: m.team_id,
        })),
      },
      data: full,
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    db.release();
  }
}

async function removeInviteHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const meetingId = parseMeetingId(req.params.meetingId);
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id");
    }

    const meeting = await db.query(
      `SELECT id FROM meetings WHERE id = $1 AND company_id = $2`,
      [meetingId, req.company.id],
    );
    if (!meeting.rows[0]) {
      return sendError(res, 404, "Meeting not found");
    }

    const body = req.body || {};
    const membersRaw =
      body.Members ??
      body.members ??
      (body.EmployeeName ? [body.EmployeeName] : null);
    const teamsRaw =
      body.Teams ?? body.teams ?? (body.TeamName ? [body.TeamName] : null);

    if (
      (membersRaw === null || membersRaw === undefined) &&
      (teamsRaw === null || teamsRaw === undefined)
    ) {
      return sendError(res, 400, "Provide Members and/or Teams to remove");
    }

    await db.query("BEGIN");

    if (membersRaw !== null && membersRaw !== undefined) {
      const membersResult = await resolveMembers(db, req.company.id, membersRaw);
      if (membersResult.errors) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "One or more members not found", membersResult.errors);
      }
      for (const member of membersResult.members) {
        await db.query(
          `DELETE FROM meeting_members WHERE meeting_id = $1 AND user_id = $2`,
          [meetingId, member.id],
        );
      }
    }

    if (teamsRaw !== null && teamsRaw !== undefined) {
      const teamsResult = await resolveTeams(db, req.company.id, teamsRaw);
      if (teamsResult.errors) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "One or more teams not found", teamsResult.errors);
      }
      // Removing a team also removes that team's members from the meeting
      await removeTeamsWithMembers(
        db,
        req.company.id,
        meetingId,
        teamsResult.teams,
      );
    }

    await db.query("COMMIT");

    const full = await fetchMeetingById(req.company.id, meetingId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Invite removed successfully",
      data: full,
    });
  } catch (error) {
    try {
      await db.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    db.release();
  }
}

router.post("/invite/:meetingId", canManage, inviteToMeetingHandler);
router.delete("/invite/:meetingId", canManage, removeInviteHandler);
router.all("/invite/:meetingId", methodNotAllowed(["POST", "DELETE"]));

router.post("/meetingId/:meetingId/invite", canManage, inviteToMeetingHandler);
router.delete("/meetingId/:meetingId/invite", canManage, removeInviteHandler);
router.all(
  "/meetingId/:meetingId/invite",
  methodNotAllowed(["POST", "DELETE"]),
);

router.post("/:meetingId/invite", canManage, inviteToMeetingHandler);
router.delete("/:meetingId/invite", canManage, removeInviteHandler);
router.all("/:meetingId/invite", methodNotAllowed(["POST", "DELETE"]));

// =====================================================
// DELETE
// DELETE /api/company/meetings/12
// DELETE /api/company/meetings/delete/12
// DELETE /api/company/meetings/meetingId/12
// =====================================================
router.delete("/delete/:meetingId", canManage, deleteMeetingHandler);
router.all("/delete/:meetingId", methodNotAllowed(["DELETE"]));

router.patch("/:meetingId", canManage, updateMeetingHandler);
router.put("/:meetingId", canManage, updateMeetingHandler);
router.delete("/:meetingId", canManage, deleteMeetingHandler);

// Method validation for CRUD collection + item routes
router.all("/", methodNotAllowed(COLLECTION_METHODS));
router.all("/:meetingId", methodNotAllowed(ITEM_METHODS));

module.exports = router;
