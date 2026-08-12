const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../config/db");

const router = express.Router({ mergeParams: true });

const validateEmail = (value) =>
  /^\S+@\S+\.\S+$/.test(String(value || "").trim());

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

const parseClientId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:clientId[:/])?(\d+)$/i);
  if (!matched) return null;
  const id = Number.parseInt(matched[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const canManage = authorizeRole("company", "super_admin");

function pickClientBody(body = {}) {
  return {
    clientName:
      body.ClientName ??
      body.clientName ??
      body.name ??
      body.companyName ??
      null,
    email: body.Email ?? body.email ?? body.companyEmail ?? null,
    password: body.password ?? body.Password ?? null,
    projectName: body.projectName ?? body.ProjectName ?? body.project_name ?? null,
    projectDescription:
      body.ProjectDescription ??
      body.projectDescription ??
      body.project_description ??
      body.description ??
      null,
  };
}

function formatClient(row) {
  return {
    id: row.id,
    ClientName: row.name,
    Email: row.email,
    company_id: row.company_id,
    user_id: row.user_id,
    address: row.address ?? null,
    industry: row.industry ?? null,
    AccountOwnerName: row.account_owner_name ?? null,
    companySize: row.company_size ?? null,
    revenu: row.revenue !== null && row.revenue !== undefined ? Number(row.revenue) : null,
    location: row.location ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
  };
}

async function fetchClientProjects(companyId, clientId) {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      name AS "projectName",
      description AS "ProjectDescription",
      status,
      start_date,
      due_date,
      end_date,
      created_at,
      updated_at
    FROM projects
    WHERE company_id = $1 AND client_id = $2
    ORDER BY created_at DESC
    `,
    [companyId, clientId],
  );
  return rows;
}

async function fetchClientById(companyId, clientId) {
  const { rows } = await pool.query(
    `
    SELECT
      id, company_id, user_id, name, email,
      address, industry, account_owner_name, company_size,
      revenue, location, created_at, updated_at
    FROM clients
    WHERE id = $1 AND company_id = $2
    `,
    [clientId, companyId],
  );
  if (!rows[0]) return null;
  const projects = await fetchClientProjects(companyId, clientId);
  return {
    ...formatClient(rows[0]),
    projects,
  };
}

function validateCreate(data) {
  const errors = [];
  if (!data.clientName || !String(data.clientName).trim()) {
    errors.push({ field: "ClientName", message: "ClientName is required" });
  }
  if (!data.email || !String(data.email).trim()) {
    errors.push({ field: "Email", message: "Email is required" });
  } else if (!validateEmail(data.email)) {
    errors.push({ field: "Email", message: "Email must be a valid email address" });
  }
  if (!data.password) {
    errors.push({ field: "password", message: "password is required" });
  } else if (String(data.password).length < 6) {
    errors.push({
      field: "password",
      message: "password must be at least 6 characters",
    });
  }
  if (!data.projectName || !String(data.projectName).trim()) {
    errors.push({ field: "projectName", message: "projectName is required" });
  }
  return errors;
}

// =====================================================
// CREATE
// POST /api/company/clients
// Body: ClientName, Email, password, projectName, ProjectDescription
// =====================================================
async function createClientHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const data = pickClientBody(req.body || {});
    const errors = validateCreate(data);
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const clientName = String(data.clientName).trim();
    const email = String(data.email).trim().toLowerCase();
    const projectName = String(data.projectName).trim();
    const projectDescription = data.projectDescription
      ? String(data.projectDescription).trim()
      : null;

    const existing = await db.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (existing.rows[0]) {
      return sendError(res, 409, "A user with that email already exists", [
        { field: "Email", message: "Email already in use" },
      ]);
    }

    await db.query("BEGIN");

    const passwordHash = await bcrypt.hash(String(data.password), 10);

    const { rows: userRows } = await db.query(
      `INSERT INTO users (name, email, password, role, company_id)
       VALUES ($1, $2, $3, 'client', $4)
       RETURNING id, name, email, role, company_id`,
      [clientName, email, passwordHash, req.company.id],
    );

    const { rows: clientRows } = await db.query(
      `
      INSERT INTO clients (name, email, company_id, user_id, company_name, account_owner_name)
      VALUES ($1, $2, $3, $4, $1, $1)
      RETURNING id, company_id, user_id, name, email, address, industry,
                account_owner_name, company_size, revenue, location, created_at, updated_at
      `,
      [clientName, email, req.company.id, userRows[0].id],
    );

    const { rows: projectRows } = await db.query(
      `
      INSERT INTO projects (company_id, name, description, client_id, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING
        id,
        name AS "projectName",
        description AS "ProjectDescription",
        status,
        client_id,
        created_at
      `,
      [req.company.id, projectName, projectDescription, clientRows[0].id],
    );

    await db.query("COMMIT");

    return res.status(201).json({
      success: true,
      code: 201,
      message: "Client created successfully",
      data: {
        ...formatClient(clientRows[0]),
        project: projectRows[0],
        projects: [projectRows[0]],
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

router.post("/", canManage, createClientHandler);
router.post("/create", canManage, createClientHandler);
router.all("/create", methodNotAllowed(["POST"]));

// =====================================================
// LIST
// =====================================================
router.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id, company_id, user_id, name, email,
        address, industry, account_owner_name, company_size,
        revenue, location, created_at, updated_at
      FROM clients
      WHERE company_id = $1
      ORDER BY created_at DESC
      `,
      [req.company.id],
    );

    const data = [];
    for (const row of rows) {
      const projects = await fetchClientProjects(req.company.id, row.id);
      data.push({
        ...formatClient(row),
        projects,
      });
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Clients fetched successfully",
      count: data.length,
      companyId: req.company.id,
      data,
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// GET ONE
// =====================================================
async function getClientHandler(req, res, next) {
  try {
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return sendError(res, 400, "Invalid client id", [
        {
          field: "clientId",
          message: "Use /clients/12 or /clients/clientId/12",
        },
      ]);
    }

    const client = await fetchClientById(req.company.id, clientId);
    if (!client) return sendError(res, 404, "Client not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Client fetched successfully",
      data: client,
    });
  } catch (error) {
    next(error);
  }
}

router.get("/clientId/:clientId", getClientHandler);
router.get("/:clientId", getClientHandler);

// =====================================================
// EDIT
// =====================================================
async function updateClientHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return sendError(res, 400, "Invalid client id");
    }

    const existing = await db.query(
      `SELECT id, user_id, name, email FROM clients WHERE id = $1 AND company_id = $2`,
      [clientId, req.company.id],
    );
    if (!existing.rows[0]) {
      return sendError(res, 404, "Client not found");
    }

    const data = pickClientBody(req.body || {});
    const errors = [];

    let clientName = undefined;
    if (data.clientName !== null && data.clientName !== undefined && data.clientName !== "") {
      clientName = String(data.clientName).trim();
      if (!clientName) {
        errors.push({ field: "ClientName", message: "ClientName cannot be empty" });
      }
    }

    let email = undefined;
    if (data.email !== null && data.email !== undefined && data.email !== "") {
      email = String(data.email).trim().toLowerCase();
      if (!validateEmail(email)) {
        errors.push({ field: "Email", message: "Email must be a valid email address" });
      }
    }

    let passwordHash = undefined;
    if (data.password !== null && data.password !== undefined && data.password !== "") {
      if (String(data.password).length < 6) {
        errors.push({
          field: "password",
          message: "password must be at least 6 characters",
        });
      } else {
        passwordHash = await bcrypt.hash(String(data.password), 10);
      }
    }

    let projectName = undefined;
    if (
      data.projectName !== null &&
      data.projectName !== undefined &&
      data.projectName !== ""
    ) {
      projectName = String(data.projectName).trim();
    }

    let projectDescription = undefined;
    if (data.projectDescription !== null && data.projectDescription !== undefined) {
      projectDescription =
        data.projectDescription === ""
          ? null
          : String(data.projectDescription).trim();
    }

    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    if (
      clientName === undefined &&
      email === undefined &&
      passwordHash === undefined &&
      projectName === undefined &&
      projectDescription === undefined
    ) {
      return sendError(res, 400, "Provide at least one field to update", [
        {
          field: "body",
          message:
            "ClientName, Email, password, projectName, or ProjectDescription",
        },
      ]);
    }

    await db.query("BEGIN");

    if (email !== undefined) {
      const duplicate = await db.query(
        `SELECT id FROM users
         WHERE LOWER(email) = LOWER($1)
           AND id <> COALESCE($2, 0)
         LIMIT 1`,
        [email, existing.rows[0].user_id],
      );
      if (duplicate.rows[0]) {
        await db.query("ROLLBACK");
        return sendError(res, 409, "A user with that email already exists", [
          { field: "Email", message: "Email already in use" },
        ]);
      }
    }

    const { rows: updatedClients } = await db.query(
      `
      UPDATE clients SET
        name = COALESCE($1, name),
        email = COALESCE($2, email),
        company_name = COALESCE($1, company_name),
        account_owner_name = COALESCE($1, account_owner_name),
        updated_at = NOW()
      WHERE id = $3 AND company_id = $4
      RETURNING id, company_id, user_id, name, email, address, industry,
                account_owner_name, company_size, revenue, location, created_at, updated_at
      `,
      [clientName ?? null, email ?? null, clientId, req.company.id],
    );

    if (existing.rows[0].user_id) {
      await db.query(
        `
        UPDATE users SET
          name = COALESCE($1, name),
          email = COALESCE($2, email),
          password = COALESCE($3, password)
        WHERE id = $4 AND company_id = $5
        `,
        [
          clientName ?? null,
          email ?? null,
          passwordHash ?? null,
          existing.rows[0].user_id,
          req.company.id,
        ],
      );
    }

    // Update latest project for this client when project fields provided
    if (projectName !== undefined || projectDescription !== undefined) {
      const latestProject = await db.query(
        `
        SELECT id FROM projects
        WHERE company_id = $1 AND client_id = $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [req.company.id, clientId],
      );

      if (latestProject.rows[0]) {
        await db.query(
          `
          UPDATE projects SET
            name = COALESCE($1, name),
            description = CASE WHEN $2::boolean THEN $3 ELSE description END,
            updated_at = NOW()
          WHERE id = $4 AND company_id = $5
          `,
          [
            projectName ?? null,
            projectDescription !== undefined,
            projectDescription ?? null,
            latestProject.rows[0].id,
            req.company.id,
          ],
        );
      } else if (projectName) {
        await db.query(
          `
          INSERT INTO projects (company_id, name, description, client_id, status)
          VALUES ($1, $2, $3, $4, 'active')
          `,
          [
            req.company.id,
            projectName,
            projectDescription ?? null,
            clientId,
          ],
        );
      }
    }

    await db.query("COMMIT");

    const client = await fetchClientById(req.company.id, clientId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Client updated successfully",
      data: client || formatClient(updatedClients[0]),
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

router.patch("/edit/:clientId", canManage, updateClientHandler);
router.put("/edit/:clientId", canManage, updateClientHandler);
router.post("/edit/:clientId", canManage, updateClientHandler);
router.all("/edit/:clientId", methodNotAllowed(["PUT", "PATCH", "POST"]));

router.post("/edit", canManage, async (req, res, next) => {
  const body = req.body || {};
  const clientId = parseClientId(body.clientId ?? body.ClientId ?? body.id);
  if (!clientId) {
    return sendError(res, 400, "clientId is required", [
      { field: "clientId", message: "Pass clientId in body to edit" },
    ]);
  }
  req.params.clientId = String(clientId);
  return updateClientHandler(req, res, next);
});
router.all("/edit", methodNotAllowed(["POST"]));

router.patch("/clientId/:clientId", canManage, updateClientHandler);
router.put("/clientId/:clientId", canManage, updateClientHandler);

// =====================================================
// DELETE
// =====================================================
async function deleteClientHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const clientId = parseClientId(req.params.clientId);
    if (!clientId) {
      return sendError(res, 400, "Invalid client id");
    }

    const existing = await db.query(
      `SELECT id, user_id, name, email FROM clients WHERE id = $1 AND company_id = $2`,
      [clientId, req.company.id],
    );
    if (!existing.rows[0]) {
      return sendError(res, 404, "Client not found");
    }

    await db.query("BEGIN");

    // Unlink projects (keep projects, clear client_id)
    await db.query(
      `UPDATE projects SET client_id = NULL, updated_at = NOW()
       WHERE client_id = $1 AND company_id = $2`,
      [clientId, req.company.id],
    );

    await db.query(`DELETE FROM clients WHERE id = $1 AND company_id = $2`, [
      clientId,
      req.company.id,
    ]);

    if (existing.rows[0].user_id) {
      await db.query(
        `DELETE FROM users WHERE id = $1 AND company_id = $2 AND role = 'client'`,
        [existing.rows[0].user_id, req.company.id],
      );
    }

    await db.query("COMMIT");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Client deleted successfully",
      data: {
        id: existing.rows[0].id,
        ClientName: existing.rows[0].name,
        Email: existing.rows[0].email,
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

router.delete("/delete/:clientId", canManage, deleteClientHandler);
router.all("/delete/:clientId", methodNotAllowed(["DELETE"]));

router.delete("/clientId/:clientId", canManage, deleteClientHandler);
router.all(
  "/clientId/:clientId",
  methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]),
);

router.patch("/:clientId", canManage, updateClientHandler);
router.put("/:clientId", canManage, updateClientHandler);
router.delete("/:clientId", canManage, deleteClientHandler);

router.all("/", methodNotAllowed(["GET", "POST"]));
router.all("/:clientId", methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]));

module.exports = router;