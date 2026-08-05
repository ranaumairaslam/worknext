const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

// Role authorization middleware
const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          success: false,
          message: "You do not have access to this resource",
        });
    }
    next();
  };

// Helper: Generate a secure random password
const generateRandomPassword = (length = 12) => {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
};

// Helper: Generate a unique email if not explicitly provided
const generateUniqueEmail = (name, companyId) => {
  const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const uniqueTag = crypto.randomBytes(3).toString("hex");
  return `${sanitizedName}.${uniqueTag}@company${companyId}.internal`;
};

// Load company context
async function loadCompany(req, res, next) {
  if (req.company) return next();
  try {
    const userResult = await pool.query(
      "SELECT company_id FROM users WHERE id = $1",
      [req.user.id],
    );
    const companyId = userResult.rows[0]?.company_id || req.user.companyId;
    if (!companyId) {
      return res
        .status(403)
        .json({ success: false, message: "User does not belong to a company" });
    }
    req.company = { id: companyId };
    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCompany);

// =======================================================
// TEAM MANAGEMENT ENDPOINTS
// =======================================================

// POST /api/company/teams - Create a new team
router.post(
  "/",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    try {
      const { name, description } = req.body;

      if (!name || !name.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Team name is required" });
      }

      const { rows } = await pool.query(
        `INSERT INTO teams (company_id, name, description, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, company_id, name, description, leader_id, created_at`,
        [req.company.id, name.trim(), description?.trim() || null],
      );

      res
        .status(201)
        .json({
          success: true,
          message: "Team created successfully",
          data: rows[0],
        });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/company/teams - List all teams
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at,
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

    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// GET /api/company/teams/:teamId - Get single team with members
router.get("/:teamId", async (req, res, next) => {
  try {
    const team = await pool.query(
      `SELECT t.id, t.name, t.description, t.created_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       WHERE t.id = $1 AND t.company_id = $2`,
      [req.params.teamId, req.company.id],
    );

    if (!team.rows[0]) {
      return res
        .status(404)
        .json({ success: false, message: "Team not found" });
    }

    const members = await pool.query(
      `SELECT id, name, email, role, status FROM users WHERE team_id = $1`,
      [req.params.teamId],
    );

    res.json({
      success: true,
      data: { ...team.rows[0], members: members.rows },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/company/teams/:teamId - Update team details
router.put(
  "/:teamId",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    try {
      const { name, description } = req.body;

      const { rows } = await pool.query(
        `UPDATE teams SET
         name = COALESCE(NULLIF($1, ''), name),
         description = COALESCE(NULLIF($2, ''), description),
         updated_at = NOW()
       WHERE id = $3 AND company_id = $4
       RETURNING id, company_id, name, description, leader_id, updated_at`,
        [name, description, req.params.teamId, req.company.id],
      );

      if (!rows[0]) {
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }

      res.json({ success: true, message: "Team updated", data: rows[0] });
    } catch (error) {
      next(error);
    }
  },
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
 * Registers a brand-new employee with an email/password and selected role,
 * then assigns them to the team as either 'team_member' or 'team_leader'.
 */
router.post(
  "/:teamId/register-member",
  authorizeRole("company", "super_admin", "team_leader"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { name, email, password, role } = req.body;
      const { teamId } = req.params;

      if (!name || !name.trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Employee name is required" });
      }

      if (email && !validateEmail(email)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "A valid email address is required",
          });
      }

      const targetRole = role;
      if (!targetRole || !["team_member", "team_leader"].includes(targetRole)) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Role must be 'team_member' or 'team_leader'",
          });
      }

      await client.query("BEGIN");

      // 1. Check team existence within company
      const teamCheck = await client.query(
        "SELECT id FROM teams WHERE id = $1 AND company_id = $2",
        [teamId, req.company.id],
      );
      if (!teamCheck.rows[0]) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }

      // 2. Determine credentials
      const userEmail = email
        ? email.trim().toLowerCase()
        : generateUniqueEmail(name, req.company.id);
      if (!userEmail) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({
            success: false,
            message: "A valid email address is required",
          });
      }

      const existingUser = await client.query(
        "SELECT id FROM users WHERE email = $1",
        [userEmail],
      );
      if (existingUser.rows[0]) {
        await client.query("ROLLBACK");
        return res
          .status(409)
          .json({
            success: false,
            message: "A user with this email already exists",
          });
      }

      const plainPassword =
        password && String(password).trim().length >= 6
          ? String(password).trim()
          : generateRandomPassword();
      if (password && String(password).trim().length < 6) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({
            success: false,
            message: "Password must be at least 6 characters long",
          });
      }

      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      const newUser = await client.query(
        `INSERT INTO users (company_id, team_id, name, email, password, role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, name, email, role, team_id, created_at`,
        [
          req.company.id,
          teamId,
          name.trim(),
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

      res.status(201).json({
        success: true,
        message: `Employee registered and assigned as ${targetRole}`,
        data: {
          user: registeredUser,
          credentials: {
            email: userEmail,
            password: plainPassword,
            dashboard: getDashboardUrl(targetRole),
          },
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

// PUT /api/company/teams/:teamId/assign-leader - Promote existing user to team leader
router.put(
  "/:teamId/assign-leader",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    const client = await pool.connect();
    try {
      const { userId } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({
            success: false,
            message: "userId is required to assign a team leader",
          });
      }

      await client.query("BEGIN");

      const team = await client.query(
        "SELECT id FROM teams WHERE id = $1 AND company_id = $2",
        [req.params.teamId, req.company.id],
      );
      if (!team.rows[0]) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }

      const user = await client.query(
        "SELECT id, name, email FROM users WHERE id = $1 AND company_id = $2",
        [userId, req.company.id],
      );
      if (!user.rows[0]) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({
            success: false,
            message: "Employee not found in this company",
          });
      }

      const updatedTeam = await client.query(
        `UPDATE teams SET leader_id = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, name, leader_id`,
        [userId, req.params.teamId],
      );

      await client.query(
        `UPDATE users SET role = 'team_leader', team_id = $1 WHERE id = $2`,
        [req.params.teamId, userId],
      );

      await client.query("COMMIT");

      res.json({
        success: true,
        message: `${user.rows[0].name} assigned as team leader`,
        data: updatedTeam.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  },
);

// POST /api/company/teams/:teamId/members - Attach existing employee to a team
router.post(
  "/:teamId/members",
  authorizeRole("company", "team_leader"),
  async (req, res, next) => {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res
          .status(400)
          .json({ success: false, message: "userId is required" });
      }

      const { rows } = await pool.query(
        `UPDATE users SET team_id = $1, role = COALESCE(NULLIF(role, 'company'), 'team_member')
       WHERE id = $2 AND company_id = $3
       RETURNING id, name, email, role, team_id`,
        [req.params.teamId, userId, req.company.id],
      );

      if (!rows[0]) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Employee not found in this company",
          });
      }

      res.json({
        success: true,
        message: "Member added to team",
        data: rows[0],
      });
    } catch (error) {
      next(error);
    }
  },
);

// DELETE /api/company/teams/:teamId - Delete a team
router.delete(
  "/:teamId",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "DELETE FROM teams WHERE id = $1 AND company_id = $2 RETURNING id",
        [req.params.teamId, req.company.id],
      );

      if (!rows[0]) {
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }

      res.json({ success: true, message: "Team deleted" });
    } catch (error) {
      next(error);
    }
  },
);

module.exports = router;
