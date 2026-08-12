const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
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

const parseTeamId = (raw) => {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const generateRandomPassword = (length = 12) => {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
};

const generateUniqueEmail = (name, companyId) => {
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const uniqueTag = crypto.randomBytes(3).toString("hex");
  return `${sanitizedName}.${uniqueTag}@company${companyId}.internal`;
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
// POST /api/company/teams - Create a new team
// =======================================================
router.post(
  "/",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    try {
      const { name, description } = req.body || {};

      if (!name || !String(name).trim()) {
        return sendError(res, 400, "Team name is required", [
          { field: "name", message: "name is required" },
        ]);
      }

      const { rows } = await pool.query(
        `INSERT INTO teams (company_id, name, description, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         RETURNING id, company_id, name, description, leader_id, created_at, updated_at`,
        [
          req.company.id,
          String(name).trim(),
          description ? String(description).trim() : null,
        ],
      );

      return sendSuccess(res, 201, "Team created successfully", rows[0]);
    } catch (error) {
      next(error);
    }
  },
);

// =======================================================
// GET /api/company/teams - List all teams
// =======================================================
router.get("/", async (req, res, next) => {
  try {
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
      [req.company.id],
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Teams fetched successfully",
      count: rows.length,
      companyId: req.company.id,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

router.all("/", methodNotAllowed(["GET", "POST"]));

// =======================================================
// GET /api/company/teams/:teamId - Get single team
// =======================================================
router.get("/:teamId", async (req, res, next) => {
  try {
    const teamId = parseTeamId(req.params.teamId);
    if (!teamId) {
      return sendError(res, 400, "Invalid team id");
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
});

// =======================================================
// PUT / PATCH /api/company/teams/:teamId - Update team
// =======================================================
async function updateTeamHandler(req, res, next) {
  try {
    const teamId = parseTeamId(req.params.teamId);
    if (!teamId) {
      return sendError(res, 400, "Invalid team id");
    }

    const { name, description } = req.body || {};
    if (name === undefined && description === undefined) {
      return sendError(res, 400, "Provide at least one field: name, description");
    }
    if (name !== undefined && !String(name).trim()) {
      return sendError(res, 400, "Team name cannot be empty");
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

// =======================================================
// EMPLOYEE REGISTRATION & ROLE ASSIGNMENT
// =======================================================

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getDashboardUrl(role) {
  switch (role) {
    case "team_leader":
      return "/api/team-leader/dashboard";
    case "team_member":
      return "/api/team-member/dashboard";
    default:
      return "/";
  }
}

/**
 * POST /api/company/teams/:teamId/register-member
 */
router.post(
  "/:teamId/register-member",
  authorizeRole("company", "super_admin", "team_leader"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { name, email, password, role } = req.body || {};
      const teamId = parseTeamId(req.params.teamId);
      if (!teamId) {
        return sendError(res, 400, "Invalid team id");
      }

      if (!name || !String(name).trim()) {
        return sendError(res, 400, "Employee name is required");
      }

      if (email && !validateEmail(email)) {
        return sendError(res, 400, "A valid email address is required");
      }

      const targetRole = role;
      if (!targetRole || !["team_member", "team_leader"].includes(targetRole)) {
        return sendError(
          res,
          400,
          "Role must be 'team_member' or 'team_leader'",
        );
      }

      await client.query("BEGIN");

      const teamCheck = await client.query(
        "SELECT id FROM teams WHERE id = $1 AND company_id = $2",
        [teamId, req.company.id],
      );
      if (!teamCheck.rows[0]) {
        await client.query("ROLLBACK");
        return sendError(res, 404, "Team not found");
      }

      const userEmail = email
        ? email.trim().toLowerCase()
        : generateUniqueEmail(name, req.company.id);

      const existingUser = await client.query(
        "SELECT id FROM users WHERE email = $1",
        [userEmail],
      );
      if (existingUser.rows[0]) {
        await client.query("ROLLBACK");
        return sendError(res, 409, "A user with this email already exists");
      }

      if (password && String(password).trim().length < 6) {
        await client.query("ROLLBACK");
        return sendError(res, 400, "Password must be at least 6 characters long");
      }

      const plainPassword =
        password && String(password).trim().length >= 6
          ? String(password).trim()
          : generateRandomPassword();

      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      const newUser = await client.query(
        `INSERT INTO users (company_id, team_id, name, email, password, role, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
         RETURNING id, name, email, role, team_id, created_at`,
        [
          req.company.id,
          teamId,
          String(name).trim(),
          userEmail,
          hashedPassword,
          targetRole,
        ],
      );

      const registeredUser = newUser.rows[0];

      if (targetRole === "team_leader") {
        await client.query(
          "UPDATE teams SET leader_id = $1, updated_at = NOW() WHERE id = $2",
          [registeredUser.id, teamId],
        );
      }

      await client.query("COMMIT");

      return sendSuccess(
        res,
        201,
        `Employee registered and assigned as ${targetRole}`,
        {
          user: registeredUser,
          credentials: {
            email: userEmail,
            password: plainPassword,
            dashboard: getDashboardUrl(targetRole),
          },
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

// Method validation for /:teamId (after nested routes)
router.all("/:teamId", methodNotAllowed(["GET", "PUT", "PATCH"]));

module.exports = router;
