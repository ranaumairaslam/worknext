const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

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

const sendSuccess = (res, status, message, data = null) => {
  const payload = { success: true, code: status, message };
  if (data !== null) payload.data = data;
  return res.status(status).json(payload);
};

const sendError = (res, status, message, errors = null) => {
  const payload = { success: false, code: status, message };
  if (errors) payload.errors = errors;
  return res.status(status).json(payload);
};

// Accepts: "15" | "teamId:15" | "teamId/15"
const parseTeamId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:teamId[:/])?(\d+)$/i);
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

// =======================================================
// CREATE TEAM
// POST /api/company/teams
// POST /api/company/teams/create
// Body: { "teamName": "...", "description": "..." }
// Optional: { "TeamLeaderName": "..." }
// =======================================================
async function createTeamHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const body = req.body || {};
    const teamName = body.teamName ?? body.name ?? body.TeamName;
    const description = body.description ?? body.Description ?? null;
    const teamLeaderName =
      body.TeamLeaderName ?? body.teamLeaderName ?? body.leaderName ?? null;

    const errors = [];
    if (!teamName || !String(teamName).trim()) {
      errors.push({ field: "teamName", message: "teamName is required" });
    }
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const cleanName = String(teamName).trim();
    const cleanDescription = description ? String(description).trim() : null;

    await db.query("BEGIN");

    const duplicate = await db.query(
      `SELECT id FROM teams
       WHERE company_id = $1 AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [req.company.id, cleanName],
    );
    if (duplicate.rows[0]) {
      await db.query("ROLLBACK");
      return sendError(res, 409, "A team with this name already exists", [
        { field: "teamName", message: `"${cleanName}" already exists` },
      ]);
    }

    let leaderId = null;
    let leader = null;

    if (teamLeaderName && String(teamLeaderName).trim()) {
      const leaderResult = await db.query(
        `SELECT id, name, email, role
         FROM users
         WHERE company_id = $1
           AND LOWER(name) = LOWER($2)
           AND role IN ('team_leader', 'team_member', 'company')
         ORDER BY id DESC
         LIMIT 1`,
        [req.company.id, String(teamLeaderName).trim()],
      );
      leader = leaderResult.rows[0];
      if (!leader) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "TeamLeaderName not found in your company", [
          {
            field: "TeamLeaderName",
            message: `No employee found for "${String(teamLeaderName).trim()}"`,
          },
        ]);
      }
      leaderId = leader.id;
    }

    const { rows } = await db.query(
      `INSERT INTO teams (company_id, name, description, leader_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, company_id, name, description, leader_id, created_at, updated_at`,
      [req.company.id, cleanName, cleanDescription, leaderId],
    );

    const team = rows[0];

    if (leader && leader.role !== "company" && leader.role !== "super_admin") {
      await db.query(
        `UPDATE users
         SET role = 'team_leader', team_id = $1
         WHERE id = $2 AND company_id = $3`,
        [team.id, leader.id, req.company.id],
      );
    }

    await db.query("COMMIT");

    return res.status(201).json({
      success: true,
      code: 201,
      message: "Team created successfully",
      data: {
        id: team.id,
        teamName: team.name,
        description: team.description,
        companyId: team.company_id,
        leaderId: team.leader_id,
        TeamLeaderName: leader ? leader.name : null,
        createdAt: team.created_at,
        updatedAt: team.updated_at,
      },
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

router.post("/", authorizeRole("company", "super_admin"), createTeamHandler);

// =======================================================
// GET /api/company/teams
// GET /api/company/teams?companyId=15
// Company role can only query their own companyId.
// =======================================================
router.get("/", async (req, res, next) => {
  try {
    let targetCompanyId = req.company.id;

    if (req.query.companyId !== undefined && req.query.companyId !== "") {
      const requestedId = Number.parseInt(req.query.companyId, 10);
      if (!Number.isInteger(requestedId) || requestedId <= 0) {
        return sendError(res, 400, "Invalid companyId");
      }

      if (req.user.role === "company" && requestedId !== Number(req.company.id)) {
        return sendError(
          res,
          403,
          "You can only view teams of your own company",
        );
      }

      targetCompanyId = requestedId;
    }

    const companyCheck = await pool.query(
      `SELECT id, name, email, status FROM companies WHERE id = $1`,
      [targetCompanyId],
    );
    if (!companyCheck.rows[0]) {
      return sendError(res, 404, "Company not found");
    }

    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email,
              COUNT(members.id)::int AS member_count
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       LEFT JOIN users members ON members.team_id = t.id
       WHERE t.company_id = $1
       GROUP BY t.id, leader.id, leader.name, leader.email
       ORDER BY t.created_at DESC`,
      [targetCompanyId],
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Teams fetched successfully",
      count: rows.length,
      companyId: targetCompanyId,
      company: {
        id: companyCheck.rows[0].id,
        name: companyCheck.rows[0].name,
        email: companyCheck.rows[0].email,
        status: companyCheck.rows[0].status,
      },
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// Method validation for create/list collection
// POST = createTeam, GET = list teams
router.all("/", methodNotAllowed(["GET", "POST"]));

// Explicit createTeam path (POST only)
router.post(
  "/create",
  authorizeRole("company", "super_admin"),
  createTeamHandler,
);
router.all("/create", methodNotAllowed(["POST"]));

/**
 * REGISTER / ASSIGN MEMBER TO TEAM
 * POST /api/company/teams/register-member
 * POST /api/company/teams/:teamId/register-member
 *
 * Input (only 2 fields):
 * {
 *   "TeamId": 15,
 *   "EmployeeName": "Ali Raza"
 * }
 */
async function registerMemberHandler(req, res, next) {
  const client = await pool.connect();
  try {
    const body = req.body || {};
    const employeeName =
      body.EmployeeName ?? body.employeeName ?? body.name ?? null;
    const bodyTeamId = parseTeamId(body.TeamId ?? body.teamId);
    const pathTeamId = parseTeamId(req.params.teamId);

    const errors = [];
    if (!employeeName || !String(employeeName).trim()) {
      errors.push({
        field: "EmployeeName",
        message: "EmployeeName is required",
      });
    }

    const teamId = pathTeamId || bodyTeamId;
    if (!teamId) {
      errors.push({ field: "TeamId", message: "TeamId is required" });
    }

    if (
      pathTeamId &&
      bodyTeamId &&
      Number(pathTeamId) !== Number(bodyTeamId)
    ) {
      errors.push({
        field: "TeamId",
        message: "TeamId in body must match TeamId in URL",
      });
    }

    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    await client.query("BEGIN");

    const teamCheck = await client.query(
      `SELECT id, name FROM teams WHERE id = $1 AND company_id = $2`,
      [teamId, req.company.id],
    );
    if (!teamCheck.rows[0]) {
      await client.query("ROLLBACK");
      return sendError(res, 404, "Team not found", [
        { field: "TeamId", message: `No team found for TeamId ${teamId}` },
      ]);
    }

    const employeeResult = await client.query(
      `SELECT id, name, email, role, team_id, status
       FROM users
       WHERE company_id = $1
         AND LOWER(name) = LOWER($2)
         AND role IN ('team_member', 'team_leader', 'company')
       ORDER BY id DESC
       LIMIT 1`,
      [req.company.id, String(employeeName).trim()],
    );

    const employee = employeeResult.rows[0];
    if (!employee) {
      await client.query("ROLLBACK");
      return sendError(res, 404, "EmployeeName not found in your company", [
        {
          field: "EmployeeName",
          message: `No employee found for "${String(employeeName).trim()}"`,
        },
      ]);
    }

    if (employee.role === "company" || employee.role === "super_admin") {
      await client.query("ROLLBACK");
      return sendError(
        res,
        400,
        "Company admin cannot be registered as a team member",
        [
          {
            field: "EmployeeName",
            message: "Choose a team_member or team_leader employee",
          },
        ],
      );
    }

    const { rows } = await client.query(
      `UPDATE users
       SET team_id = $1,
           role = CASE
             WHEN role = 'team_leader' THEN role
             ELSE 'team_member'
           END
       WHERE id = $2 AND company_id = $3
       RETURNING id, name, email, role, team_id, status, created_at`,
      [teamId, employee.id, req.company.id],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Employee assigned to team successfully",
      data: {
        TeamId: teamId,
        teamName: teamCheck.rows[0].name,
        EmployeeName: rows[0].name,
        employeeId: rows[0].id,
        email: rows[0].email,
        role: rows[0].role,
        team_id: rows[0].team_id,
      },
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      /* ignore */
    }
    next(error);
  } finally {
    client.release();
  }
}

// Body style: { TeamId, EmployeeName }
router.post(
  "/register-member",
  authorizeRole("company", "super_admin", "team_leader"),
  registerMemberHandler,
);
router.all("/register-member", methodNotAllowed(["POST"]));

// Path style: /api/company/teams/15/register-member
router.post(
  "/:teamId/register-member",
  authorizeRole("company", "super_admin", "team_leader"),
  registerMemberHandler,
);
router.all("/:teamId/register-member", methodNotAllowed(["POST"]));

// =======================================================
// GET / UPDATE / DELETE single team
// URLs:
//   /api/company/teams/15
//   /api/company/teams/teamId/15
//   /api/company/teams/teamId:15
// =======================================================

async function getTeamHandler(req, res, next) {
  try {
    const teamId = parseTeamId(req.params.teamId);
    if (!teamId) {
      return sendError(
        res,
        400,
        "Invalid team id. Use /teams/15 or /teams/teamId:15",
      );
    }

    const team = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [teamId, req.company.id],
    );

    if (!team.rows[0]) {
      return sendError(res, 404, "Team not found");
    }

    const members = await pool.query(
      `SELECT id, name, email, role, status FROM users WHERE team_id = $1`,
      [teamId],
    );

    return sendSuccess(res, 200, "Team fetched successfully", {
      ...team.rows[0],
      members: members.rows,
    });
  } catch (error) {
    next(error);
  }
}

async function updateTeamHandler(req, res, next) {
  try {
    const teamId = parseTeamId(req.params.teamId);
    if (!teamId) {
      return sendError(
        res,
        400,
        "Invalid team id. Use /teams/15 or /teams/teamId:15",
      );
    }

    const { name, description } = req.body || {};
    if (name === undefined && description === undefined) {
      return sendError(res, 400, "Provide at least one field: name, description", [
        { field: "name", message: "name is optional but at least one field required" },
        { field: "description", message: "description is optional but at least one field required" },
      ]);
    }
    if (name !== undefined && !String(name).trim()) {
      return sendError(res, 400, "Team name cannot be empty", [
        { field: "name", message: "name cannot be empty" },
      ]);
    }

    const sets = ["updated_at = NOW()"];
    const values = [];

    if (name !== undefined) {
      values.push(String(name).trim());
      sets.push(`name = $${values.length}`);
    }
    if (description !== undefined) {
      values.push(
        description === null || description === ""
          ? null
          : String(description).trim(),
      );
      sets.push(`description = $${values.length}`);
    }

    values.push(teamId, req.company.id);

    const { rows } = await pool.query(
      `UPDATE teams SET ${sets.join(", ")}
       WHERE id = $${values.length - 1} AND company_id = $${values.length}
       RETURNING id, company_id, name, description, leader_id, created_at, updated_at`,
      values,
    );

    if (!rows[0]) {
      return sendError(res, 404, "Team not found");
    }

    return sendSuccess(res, 200, "Team updated successfully", rows[0]);
  } catch (error) {
    next(error);
  }
}

async function deleteTeamHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const teamId = parseTeamId(req.params.teamId);
    if (!teamId) {
      return sendError(
        res,
        400,
        "Invalid team id. Use /teams/15 or /teams/teamId:15",
      );
    }

    const existing = await db.query(
      `SELECT id, name, company_id, description, leader_id
       FROM teams
       WHERE id = $1 AND company_id = $2`,
      [teamId, req.company.id],
    );

    if (!existing.rows[0]) {
      return sendError(res, 404, "Team not found");
    }

    await db.query("BEGIN");

    await db.query(
      `UPDATE users SET team_id = NULL
       WHERE team_id = $1 AND company_id = $2`,
      [teamId, req.company.id],
    );

    await db.query(
      `UPDATE projects SET team_id = NULL
       WHERE team_id = $1 AND company_id = $2`,
      [teamId, req.company.id],
    );

    const deleted = await db.query(
      `DELETE FROM teams
       WHERE id = $1 AND company_id = $2
       RETURNING id, name, description, company_id`,
      [teamId, req.company.id],
    );

    await db.query("COMMIT");

    return sendSuccess(res, 200, "Team deleted successfully", deleted.rows[0]);
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

const TEAM_ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

// Explicit: /api/company/teams/teamId/15
router.get("/teamId/:teamId", getTeamHandler);
router.put(
  "/teamId/:teamId",
  authorizeRole("company", "super_admin"),
  updateTeamHandler,
);
router.patch(
  "/teamId/:teamId",
  authorizeRole("company", "super_admin"),
  updateTeamHandler,
);
router.delete(
  "/teamId/:teamId",
  authorizeRole("company", "super_admin"),
  deleteTeamHandler,
);
router.all("/teamId/:teamId", methodNotAllowed(TEAM_ITEM_METHODS));

// Short / colon: /api/company/teams/15  or  /api/company/teams/teamId:15
router.get("/:teamId", getTeamHandler);
router.put(
  "/:teamId",
  authorizeRole("company", "super_admin"),
  updateTeamHandler,
);
router.patch(
  "/:teamId",
  authorizeRole("company", "super_admin"),
  updateTeamHandler,
);
router.delete(
  "/:teamId",
  authorizeRole("company", "super_admin"),
  deleteTeamHandler,
);

// PUT /api/company/teams/:teamId/assign-leader
router.put(
  "/:teamId/assign-leader",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    const client = await pool.connect();

    try {
      const { userId } = req.body || {};
      const teamId = parseTeamId(req.params.teamId);

      if (!teamId) {
        return sendError(res, 400, "Invalid team id");
      }
      if (!userId) {
        return sendError(res, 400, "userId is required");
      }

      await client.query("BEGIN");

      const team = await client.query(
        `SELECT id, name FROM teams WHERE id = $1 AND company_id = $2`,
        [teamId, req.company.id],
      );

      if (!team.rows.length) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Team not found");
      }

      const user = await client.query(
        `SELECT id, name, email FROM users WHERE id = $1 AND company_id = $2`,
        [userId, req.company.id],
      );

      if (!user.rows.length) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Employee not found in this company");
      }

      const updatedTeam = await client.query(
        `UPDATE teams
         SET leader_id = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, leader_id`,
        [userId, teamId],
      );

      await client.query(
        `UPDATE users
         SET role = 'team_leader', team_id = $1
         WHERE id = $2`,
        [teamId, userId],
      );

      await client.query("COMMIT");

      return sendSuccess(
        res,
        200,
        `${user.rows[0].name} assigned as Team Leader successfully`,
        {
          team: updatedTeam.rows[0],
          leader: user.rows[0],
        },
      );
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        /* ignore */
      }
      next(error);
    } finally {
      client.release();
    }
  },
);
router.all(
  "/:teamId/assign-leader",
  methodNotAllowed(["PUT"]),
);

// Method validation for /:teamId (after nested routes)
router.all("/:teamId", methodNotAllowed(TEAM_ITEM_METHODS));

module.exports = router;
