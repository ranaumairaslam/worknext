const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../../config/db");
const { normalizeRole } = require("../../middleware/role.middleware");

const router = express.Router({ mergeParams: true });

const validateEmail = (value) =>
  /^\S+@\S+\.\S+$/.test(String(value || "").trim());

const authorizeRole =
  (...roles) =>
  (req, res, next) => {
    const allowed = roles.map((role) => normalizeRole(role));
    if (!allowed.includes(normalizeRole(req.user?.role))) {
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

// Accepts: "15" | "employeeId:15" | "employeeId/15"
const parseEmployeeId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:employeeId[:/])?(\d+)$/i);
  if (!matched) return null;
  const id = Number.parseInt(matched[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parseTeamId = (raw) => {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const positiveInteger = (value, fallback = 1, maximum = 100) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
};

const generateRandomPassword = (length = 12) =>
  crypto.randomBytes(length).toString("base64").slice(0, length);

const mapEmployee = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    EmployeeName: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    TeamId: row.team_id,
    teamName: row.team_name || null,
    companyId: row.company_id,
    createdAt: row.created_at,
  };
};

const EMPLOYEE_ROLES = ["team_member", "team_leader"];
const EMPLOYEE_STATUSES = ["active", "inactive"];

// =======================================================
// CREATE EMPLOYEE
// POST /api/company/employees
// POST /api/company/employees/create
// =======================================================
const normalizeEmployeeRole = (raw) => {
  if (raw === undefined || raw === null || raw === "") return "team_member";
  const value = String(raw).trim().toLowerCase();
  const aliases = {
    team_member: "team_member",
    member: "team_member",
    employee: "team_member",
    developer: "team_member",
    dev: "team_member",
    team_leader: "team_leader",
    leader: "team_leader",
    teamleader: "team_leader",
  };
  return aliases[value] || value;
};

async function createEmployeeHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const body = req.body;

    // Body missing usually means Content-Type is not application/json
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length === 0) {
      return sendError(res, 400, "Request body is missing or not JSON", [
        {
          field: "body",
          message:
            "Send raw JSON with header Content-Type: application/json",
        },
      ]);
    }

    const employeeName =
      body.EmployeeName ?? body.employeeName ?? body.name ?? null;
    const email = body.email ?? body.Email ?? null;
    const password = body.password ?? body.Password ?? null;
    const roleProvided = body.role ?? body.Role;
    const role = normalizeEmployeeRole(roleProvided);
    const teamInput =
      body.TeamId ?? body.teamId ?? body.TeamName ?? body.teamName ?? null;

    const errors = [];
    if (!employeeName || !String(employeeName).trim()) {
      errors.push({ field: "EmployeeName", message: "EmployeeName is required" });
    }
    if (!email || !String(email).trim()) {
      errors.push({ field: "email", message: "email is required" });
    } else if (!validateEmail(email)) {
      errors.push({ field: "email", message: "email must be valid" });
    }
    if (password && String(password).trim().length < 6) {
      errors.push({
        field: "password",
        message: "password must be at least 6 characters",
      });
    }
    if (!EMPLOYEE_ROLES.includes(role)) {
      errors.push({
        field: "role",
        message: "role must be team_member or team_leader",
      });
    }
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const cleanName = String(employeeName).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const plainPassword =
      password && String(password).trim().length >= 6
        ? String(password).trim()
        : generateRandomPassword();

    await db.query("BEGIN");

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [
      cleanEmail,
    ]);
    if (existing.rows[0]) {
      await db.query("ROLLBACK");
      return sendError(res, 409, "A user with this email already exists", [
        { field: "email", message: "email already exists" },
      ]);
    }

    let teamId = null;
    let teamName = null;
    if (teamInput !== null && teamInput !== undefined && teamInput !== "") {
      const asId = parseTeamId(teamInput);
      let team;
      if (asId && String(asId) === String(teamInput).trim()) {
        const byId = await db.query(
          `SELECT id, name FROM teams WHERE id = $1 AND company_id = $2`,
          [asId, req.company.id],
        );
        team = byId.rows[0];
      } else {
        const byName = await db.query(
          `SELECT id, name FROM teams
           WHERE company_id = $1 AND LOWER(name) = LOWER($2)
           ORDER BY id DESC LIMIT 1`,
          [req.company.id, String(teamInput).trim()],
        );
        team = byName.rows[0];
      }
      if (!team) {
        await db.query("ROLLBACK");
        return sendError(res, 404, "Team not found in your company", [
          { field: "TeamId", message: `No team found for "${teamInput}"` },
        ]);
      }
      teamId = team.id;
      teamName = team.name;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);

    const { rows } = await db.query(
      `INSERT INTO users (company_id, team_id, name, email, password, role, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
       RETURNING id, company_id, team_id, name, email, role, status, created_at`,
      [req.company.id, teamId, cleanName, cleanEmail, passwordHash, role],
    );

    if (role === "team_leader" && teamId) {
      await db.query(
        `UPDATE teams SET leader_id = $1, updated_at = NOW()
         WHERE id = $2 AND company_id = $3`,
        [rows[0].id, teamId, req.company.id],
      );
    }

    await db.query("COMMIT");

    return res.status(201).json({
      success: true,
      code: 201,
      message: "Employee created successfully",
      data: {
        ...mapEmployee({ ...rows[0], team_name: teamName }),
        credentials: {
          email: cleanEmail,
          password: plainPassword,
        },
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

router.post("/", authorizeRole("company", "super_admin"), createEmployeeHandler);

// =======================================================
// GET ALL EMPLOYEES
// GET /api/company/employees
// GET /api/company/employees?companyId=15
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
          "You can only view employees of your own company",
        );
      }
      targetCompanyId = requestedId;
    }

    const page = positiveInteger(req.query.page, 1, 1000);
    const limit = positiveInteger(req.query.limit, 50, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || "").trim();
    const role = EMPLOYEE_ROLES.includes(req.query.role) ? req.query.role : null;
    const status = EMPLOYEE_STATUSES.includes(req.query.status)
      ? req.query.status
      : null;

    const where = [
      "u.company_id = $1",
      `u.role IN ('team_leader', 'team_member')`,
    ];
    const values = [targetCompanyId];

    if (search) {
      values.push(`%${search}%`);
      where.push(
        `(u.name ILIKE $${values.length} OR u.email ILIKE $${values.length})`,
      );
    }
    if (role) {
      values.push(role);
      where.push(`u.role = $${values.length}`);
    }
    if (status) {
      values.push(status);
      where.push(`u.status = $${values.length}`);
    }

    const whereClause = `WHERE ${where.join(" AND ")}`;

    const employees = await pool.query(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, u.team_id, u.created_at,
              t.name AS team_name
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       ${whereClause}
       ORDER BY u.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    );

    const count = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
      values,
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Employees fetched successfully",
      count: employees.rows.length,
      companyId: targetCompanyId,
      pagination: {
        page,
        limit,
        total: count.rows[0].total,
      },
      data: employees.rows.map(mapEmployee),
    });
  } catch (error) {
    next(error);
  }
});

router.all("/", methodNotAllowed(["GET", "POST"]));

router.post(
  "/create",
  authorizeRole("company", "super_admin"),
  createEmployeeHandler,
);
router.all("/create", methodNotAllowed(["POST"]));

// =======================================================
// GET / UPDATE / DELETE single employee
// /api/company/employees/15
// /api/company/employees/employeeId/15
// /api/company/employees/employeeId:15
// =======================================================
async function getEmployeeHandler(req, res, next) {
  try {
    const employeeId = parseEmployeeId(req.params.employeeId);
    if (!employeeId) {
      return sendError(
        res,
        400,
        "Invalid employee id. Use /employees/15 or /employees/employeeId:15",
      );
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, u.team_id, u.created_at,
              t.name AS team_name
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.id = $1
         AND u.company_id = $2
         AND u.role IN ('team_leader', 'team_member')`,
      [employeeId, req.company.id],
    );

    if (!rows[0]) {
      return sendError(res, 404, "Employee not found");
    }

    return sendSuccess(res, 200, "Employee fetched successfully", mapEmployee(rows[0]));
  } catch (error) {
    next(error);
  }
}

async function updateEmployeeHandler(req, res, next) {
  try {
    const employeeId = parseEmployeeId(req.params.employeeId);
    if (!employeeId) {
      return sendError(
        res,
        400,
        "Invalid employee id. Use /employees/15 or /employees/employeeId:15",
      );
    }

    const body = req.body || {};
    const employeeName =
      body.EmployeeName ?? body.employeeName ?? body.name ?? undefined;
    const email = body.email ?? body.Email ?? undefined;
    const role = body.role ?? body.Role ?? undefined;
    const status = body.status ?? body.Status ?? undefined;
    const password = body.password ?? body.Password ?? undefined;
    const teamInput =
      body.TeamId ?? body.teamId ?? body.TeamName ?? body.teamName ?? undefined;

    if (
      employeeName === undefined &&
      email === undefined &&
      role === undefined &&
      status === undefined &&
      password === undefined &&
      teamInput === undefined
    ) {
      return sendError(res, 400, "Provide at least one field to update", [
        {
          field: "body",
          message:
            "EmployeeName, email, role, status, password, TeamId are allowed",
        },
      ]);
    }

    const errors = [];
    if (employeeName !== undefined && !String(employeeName).trim()) {
      errors.push({ field: "EmployeeName", message: "EmployeeName cannot be empty" });
    }
    if (email !== undefined && !validateEmail(email)) {
      errors.push({ field: "email", message: "email must be valid" });
    }
    if (role !== undefined && !EMPLOYEE_ROLES.includes(String(role).toLowerCase())) {
      errors.push({
        field: "role",
        message: "role must be team_member or team_leader",
      });
    }
    if (
      status !== undefined &&
      !EMPLOYEE_STATUSES.includes(String(status).toLowerCase())
    ) {
      errors.push({
        field: "status",
        message: "status must be active or inactive",
      });
    }
    if (password !== undefined && String(password).trim().length < 6) {
      errors.push({
        field: "password",
        message: "password must be at least 6 characters",
      });
    }
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const existing = await pool.query(
      `SELECT id, email FROM users
       WHERE id = $1 AND company_id = $2 AND role IN ('team_leader', 'team_member')`,
      [employeeId, req.company.id],
    );
    if (!existing.rows[0]) {
      return sendError(res, 404, "Employee not found");
    }

    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      const dup = await pool.query(
        `SELECT id FROM users WHERE email = $1 AND id <> $2`,
        [cleanEmail, employeeId],
      );
      if (dup.rows[0]) {
        return sendError(res, 409, "A user with this email already exists");
      }
    }

    let teamIdValue;
    let setTeam = false;
    if (teamInput !== undefined) {
      setTeam = true;
      if (teamInput === null || teamInput === "") {
        teamIdValue = null;
      } else {
        const asId = parseTeamId(teamInput);
        let team;
        if (asId && String(asId) === String(teamInput).trim()) {
          const byId = await pool.query(
            `SELECT id FROM teams WHERE id = $1 AND company_id = $2`,
            [asId, req.company.id],
          );
          team = byId.rows[0];
        } else {
          const byName = await pool.query(
            `SELECT id FROM teams
             WHERE company_id = $1 AND LOWER(name) = LOWER($2)
             ORDER BY id DESC LIMIT 1`,
            [req.company.id, String(teamInput).trim()],
          );
          team = byName.rows[0];
        }
        if (!team) {
          return sendError(res, 404, "Team not found in your company");
        }
        teamIdValue = team.id;
      }
    }

    const sets = [];
    const values = [];

    if (employeeName !== undefined) {
      values.push(String(employeeName).trim());
      sets.push(`name = $${values.length}`);
    }
    if (email !== undefined) {
      values.push(String(email).trim().toLowerCase());
      sets.push(`email = $${values.length}`);
    }
    if (role !== undefined) {
      values.push(String(role).trim().toLowerCase());
      sets.push(`role = $${values.length}`);
    }
    if (status !== undefined) {
      values.push(String(status).trim().toLowerCase());
      sets.push(`status = $${values.length}`);
    }
    if (setTeam) {
      values.push(teamIdValue);
      sets.push(`team_id = $${values.length}`);
    }
    if (password !== undefined) {
      const hash = await bcrypt.hash(String(password).trim(), 10);
      values.push(hash);
      sets.push(`password = $${values.length}`);
    }

    values.push(employeeId, req.company.id);

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(", ")}
       WHERE id = $${values.length - 1}
         AND company_id = $${values.length}
         AND role IN ('team_leader', 'team_member')
       RETURNING id, company_id, name, email, role, status, team_id, created_at`,
      values,
    );

    if (!rows[0]) {
      return sendError(res, 404, "Employee not found");
    }

    const team = rows[0].team_id
      ? (
          await pool.query(`SELECT name FROM teams WHERE id = $1`, [
            rows[0].team_id,
          ])
        ).rows[0]
      : null;

    return sendSuccess(
      res,
      200,
      "Employee updated successfully",
      mapEmployee({ ...rows[0], team_name: team?.name || null }),
    );
  } catch (error) {
    next(error);
  }
}

async function deleteEmployeeHandler(req, res, next) {
  try {
    const employeeId = parseEmployeeId(req.params.employeeId);
    if (!employeeId) {
      return sendError(
        res,
        400,
        "Invalid employee id. Use /employees/15 or /employees/employeeId:15",
      );
    }

    // Clear team leadership if this employee leads any team
    await pool.query(
      `UPDATE teams SET leader_id = NULL, updated_at = NOW()
       WHERE leader_id = $1 AND company_id = $2`,
      [employeeId, req.company.id],
    );

    // Detach as project leader
    await pool.query(
      `UPDATE projects SET project_leader_id = NULL
       WHERE project_leader_id = $1 AND company_id = $2`,
      [employeeId, req.company.id],
    );

    const { rows } = await pool.query(
      `DELETE FROM users
       WHERE id = $1
         AND company_id = $2
         AND role IN ('team_leader', 'team_member')
       RETURNING id, name, email, role, company_id`,
      [employeeId, req.company.id],
    );

    if (!rows[0]) {
      return sendError(res, 404, "Employee not found");
    }

    return sendSuccess(res, 200, "Employee deleted successfully", {
      id: rows[0].id,
      EmployeeName: rows[0].name,
      email: rows[0].email,
      role: rows[0].role,
      companyId: rows[0].company_id,
    });
  } catch (error) {
    next(error);
  }
}

const EMPLOYEE_ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

router.get("/employeeId/:employeeId", getEmployeeHandler);
router.put(
  "/employeeId/:employeeId",
  authorizeRole("company", "super_admin"),
  updateEmployeeHandler,
);
router.patch(
  "/employeeId/:employeeId",
  authorizeRole("company", "super_admin"),
  updateEmployeeHandler,
);
router.delete(
  "/employeeId/:employeeId",
  authorizeRole("company", "super_admin"),
  deleteEmployeeHandler,
);
router.all("/employeeId/:employeeId", methodNotAllowed(EMPLOYEE_ITEM_METHODS));

router.get("/:employeeId", getEmployeeHandler);
router.put(
  "/:employeeId",
  authorizeRole("company", "super_admin"),
  updateEmployeeHandler,
);
router.patch(
  "/:employeeId",
  authorizeRole("company", "super_admin"),
  updateEmployeeHandler,
);
router.delete(
  "/:employeeId",
  authorizeRole("company", "super_admin"),
  deleteEmployeeHandler,
);
router.all("/:employeeId", methodNotAllowed(EMPLOYEE_ITEM_METHODS));

module.exports = router;
