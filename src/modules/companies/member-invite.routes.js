const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

const MEMBER_FROM_TYPES = ["Team", "Team Leader"];

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

const parseId = (raw, prefix = "id") => {
  const value = String(raw || "").trim();
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matched = value.match(new RegExp(`^(?:${escaped}[:/])?(\\d+)$`, "i"));
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

function normalizeMemberFrom(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const key = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  const compact = key.replace(/\s+/g, "");
  const map = {
    team: "Team",
    teams: "Team",
    "team member": "Team",
    teammember: "Team",
    members: "Team",
    "team leader": "Team Leader",
    "team leaders": "Team Leader",
    teamleader: "Team Leader",
    teamleaders: "Team Leader",
    lead: "Team Leader",
    leads: "Team Leader",
  };
  return map[key] || map[compact] || null;
}

function normalizeList(input) {
  if (input === null || input === undefined || input === "") return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") {
    return input
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  }
  return [input];
}

async function resolveTeams(db, companyId, teamsInput) {
  const items = normalizeList(teamsInput);
  if (!items.length) return { teams: [] };

  const resolved = [];
  const errors = [];

  for (const item of items) {
    if (item === null || item === undefined || String(item).trim() === "") continue;
    const asNumber = Number.parseInt(item, 10);
    if (Number.isInteger(asNumber) && String(asNumber) === String(item).trim()) {
      const { rows } = await db.query(
        `SELECT id, name, leader_id FROM teams WHERE id = $1 AND company_id = $2`,
        [asNumber, companyId],
      );
      if (!rows[0]) {
        errors.push({ field: "Teams", message: `Team id ${asNumber} not found` });
        continue;
      }
      resolved.push(rows[0]);
      continue;
    }

    const name = String(item).trim();
    const { rows } = await db.query(
      `SELECT id, name, leader_id FROM teams
       WHERE company_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [companyId, name],
    );
    if (!rows[0]) {
      errors.push({ field: "Teams", message: `Team "${name}" not found` });
      continue;
    }
    resolved.push(rows[0]);
  }

  if (errors.length) return { errors };

  const unique = [];
  const seen = new Set();
  for (const team of resolved) {
    if (seen.has(team.id)) continue;
    seen.add(team.id);
    unique.push(team);
  }
  return { teams: unique };
}

async function fetchInviteTargets(db, companyId, teams, memberFrom, employeeName) {
  if (!teams.length) return [];

  const teamIds = teams.map((t) => t.id);
  let rows;

  if (memberFrom === "Team Leader") {
    const result = await db.query(
      `
      SELECT DISTINCT u.id, u.name, u.email, u.role, u.team_id, t.name AS team_name
      FROM teams t
      JOIN users u ON u.company_id = $1 AND (
        u.id = t.leader_id
        OR (u.team_id = t.id AND u.role = 'team_leader')
      )
      WHERE t.company_id = $1
        AND t.id = ANY($2::int[])
      ORDER BY u.name ASC
      `,
      [companyId, teamIds],
    );
    rows = result.rows;
  } else {
    const result = await db.query(
      `
      SELECT u.id, u.name, u.email, u.role, u.team_id, t.name AS team_name
      FROM users u
      JOIN teams t ON t.id = u.team_id
      WHERE u.company_id = $1
        AND u.team_id = ANY($2::int[])
      ORDER BY u.name ASC
      `,
      [companyId, teamIds],
    );
    rows = result.rows;
  }

  if (employeeName && String(employeeName).trim()) {
    const name = String(employeeName).trim().toLowerCase();
    rows = rows.filter(
      (u) =>
        String(u.name || "").toLowerCase() === name ||
        String(u.email || "").toLowerCase() === name,
    );
  }

  return rows;
}

async function fetchMeetingInvitees(companyId, meetingId) {
  const { rows } = await pool.query(
    `
    SELECT
      m.id AS meeting_id,
      m.title AS "Title",
      m.to_whom AS "toWhome",
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
      ) AS "Members",
      (
        SELECT COALESCE(
          json_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name),
          '[]'::json
        )
        FROM meeting_teams mt
        JOIN teams t ON t.id = mt.team_id
        WHERE mt.meeting_id = m.id
      ) AS "Teams"
    FROM meetings m
    WHERE m.id = $1 AND m.company_id = $2
    `,
    [meetingId, companyId],
  );
  return rows[0] || null;
}

// =====================================================
// INVITE MEMBERS
// POST /api/company/member-invites
// POST /api/company/memberInvites
// Body:
// {
//   "meetingId": 12,
//   "MemberFrom": "Team" | "Team Leader",
//   "Teams": ["Web Development"],
//   "EmployeeName": "optional specific person"
// }
// =====================================================
async function inviteMembersHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const body = req.body || {};
    const meetingId = parseId(
      body.meetingId ?? body.MeetingId ?? req.params.meetingId,
      "meetingId",
    );
    const memberFrom = normalizeMemberFrom(
      body.MemberFrom ?? body.memberFrom ?? body.from ?? body.InviteFrom,
    );
    const teamsRaw =
      body.Teams ?? body.teams ?? body.TeamName ?? body.teamName ?? body.TeamIds;
    const employeeName =
      body.EmployeeName ?? body.employeeName ?? body.MemberName ?? body.memberName;

    const errors = [];
    if (!meetingId) {
      errors.push({ field: "meetingId", message: "meetingId is required" });
    }
    if (!memberFrom) {
      errors.push({
        field: "MemberFrom",
        message: `MemberFrom must be one of: ${MEMBER_FROM_TYPES.join(", ")}`,
      });
    }
    const teamItems = normalizeList(teamsRaw);
    if (!teamItems.length) {
      errors.push({
        field: "Teams",
        message: "Teams is required (team name or id)",
      });
    }
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const meeting = await db.query(
      `SELECT id, title FROM meetings WHERE id = $1 AND company_id = $2`,
      [meetingId, req.company.id],
    );
    if (!meeting.rows[0]) {
      return sendError(res, 404, "Meeting not found");
    }

    await db.query("BEGIN");

    const teamsResult = await resolveTeams(db, req.company.id, teamItems);
    if (teamsResult.errors) {
      await db.query("ROLLBACK");
      return sendError(res, 404, "One or more teams not found", teamsResult.errors);
    }

    const targets = await fetchInviteTargets(
      db,
      req.company.id,
      teamsResult.teams,
      memberFrom,
      employeeName,
    );

    if (!targets.length) {
      await db.query("ROLLBACK");
      return sendError(res, 404, "No members found to invite", [
        {
          field: employeeName ? "EmployeeName" : "Teams",
          message:
            memberFrom === "Team Leader"
              ? "No team leaders found for the selected teams"
              : "No team members found for the selected teams",
        },
      ]);
    }

    for (const team of teamsResult.teams) {
      await db.query(
        `INSERT INTO meeting_teams (meeting_id, team_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [meetingId, team.id],
      );
    }

    for (const user of targets) {
      await db.query(
        `INSERT INTO meeting_members (meeting_id, user_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [meetingId, user.id],
      );
    }

    await db.query("COMMIT");

    const full = await fetchMeetingInvitees(req.company.id, meetingId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Members invited successfully",
      MemberFrom: memberFrom,
      invitedCount: targets.length,
      invited: targets.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        teamId: u.team_id,
        teamName: u.team_name,
      })),
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

// GET invited members for a meeting
router.get("/meeting/:meetingId", async (req, res, next) => {
  try {
    const meetingId = parseId(req.params.meetingId, "meetingId");
    if (!meetingId) {
      return sendError(res, 400, "Invalid meeting id");
    }
    const data = await fetchMeetingInvitees(req.company.id, meetingId);
    if (!data) return sendError(res, 404, "Meeting not found");
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Meeting invitees fetched successfully",
      data,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", canManage, inviteMembersHandler);
router.post("/invite", canManage, inviteMembersHandler);
router.post("/meeting/:meetingId", canManage, async (req, res, next) => {
  req.body = { ...(req.body || {}), meetingId: req.params.meetingId };
  return inviteMembersHandler(req, res, next);
});

router.all("/", methodNotAllowed(["POST"]));
router.all("/invite", methodNotAllowed(["POST"]));
router.all("/meeting/:meetingId", methodNotAllowed(["GET", "POST"]));

module.exports = router;
