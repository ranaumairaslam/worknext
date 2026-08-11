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

const CLIENT_SELECT = `
  id,
  company_id,
  user_id,
  name,
  email,
  company_name,
  address,
  industry,
  account_owner_name,
  company_size,
  revenue,
  location,
  created_at,
  updated_at
`;

function pickClientBody(body = {}) {
  return {
    companyName: body.companyName,
    companyEmail: body.companyEmail,
    password: body.password,
    address: body.address,
    industry: body.industry,
    accountOwnerName: body.AccountOwnerName ?? body.accountOwnerName,
    companySize: body.companySize,
    revenue: body.revenu ?? body.revenue,
    location: body.location,
  };
}

function validateCreateClient(body) {
  const data = pickClientBody(body);
  const errors = [];

  if (!data.companyName || !String(data.companyName).trim()) {
    errors.push({ field: "companyName", message: "companyName is required" });
  }
  if (!data.companyEmail || !String(data.companyEmail).trim()) {
    errors.push({ field: "companyEmail", message: "companyEmail is required" });
  } else if (!validateEmail(data.companyEmail)) {
    errors.push({
      field: "companyEmail",
      message: "companyEmail must be a valid email address",
    });
  }
  if (!data.password) {
    errors.push({ field: "password", message: "password is required" });
  } else if (String(data.password).length < 6) {
    errors.push({
      field: "password",
      message: "password must be at least 6 characters",
    });
  }
  if (!data.address || !String(data.address).trim()) {
    errors.push({ field: "address", message: "address is required" });
  }
  if (!data.industry || !String(data.industry).trim()) {
    errors.push({ field: "industry", message: "industry is required" });
  }
  if (!data.accountOwnerName || !String(data.accountOwnerName).trim()) {
    errors.push({
      field: "AccountOwnerName",
      message: "AccountOwnerName is required",
    });
  }
  if (!data.companySize || !String(data.companySize).trim()) {
    errors.push({ field: "companySize", message: "companySize is required" });
  }
  if (data.revenue === undefined || data.revenue === null || data.revenue === "") {
    errors.push({ field: "revenu", message: "revenu is required" });
  } else if (Number.isNaN(Number(data.revenue))) {
    errors.push({ field: "revenu", message: "revenu must be a valid number" });
  } else if (Number(data.revenue) < 0) {
    errors.push({ field: "revenu", message: "revenu cannot be negative" });
  }
  if (!data.location || !String(data.location).trim()) {
    errors.push({ field: "location", message: "location is required" });
  }

  return { data, errors };
}

function validateUpdateClient(body) {
  const data = pickClientBody(body);
  const errors = [];
  const hasAnyField = Object.values(data).some(
    (value) => value !== undefined && value !== null && value !== "",
  );

  if (!hasAnyField) {
    errors.push({
      field: "body",
      message:
        "At least one field is required: companyName, companyEmail, password, address, industry, AccountOwnerName, companySize, revenu, location",
    });
    return { data, errors };
  }

  if (data.companyName !== undefined && !String(data.companyName).trim()) {
    errors.push({
      field: "companyName",
      message: "companyName cannot be empty",
    });
  }
  if (data.companyEmail !== undefined) {
    if (!String(data.companyEmail).trim()) {
      errors.push({
        field: "companyEmail",
        message: "companyEmail cannot be empty",
      });
    } else if (!validateEmail(data.companyEmail)) {
      errors.push({
        field: "companyEmail",
        message: "companyEmail must be a valid email address",
      });
    }
  }
  if (data.password !== undefined && String(data.password).length < 6) {
    errors.push({
      field: "password",
      message: "password must be at least 6 characters",
    });
  }
  if (data.address !== undefined && !String(data.address).trim()) {
    errors.push({ field: "address", message: "address cannot be empty" });
  }
  if (data.industry !== undefined && !String(data.industry).trim()) {
    errors.push({ field: "industry", message: "industry cannot be empty" });
  }
  if (
    data.accountOwnerName !== undefined &&
    !String(data.accountOwnerName).trim()
  ) {
    errors.push({
      field: "AccountOwnerName",
      message: "AccountOwnerName cannot be empty",
    });
  }
  if (data.companySize !== undefined && !String(data.companySize).trim()) {
    errors.push({
      field: "companySize",
      message: "companySize cannot be empty",
    });
  }
  if (data.revenue !== undefined && data.revenue !== null && data.revenue !== "") {
    if (Number.isNaN(Number(data.revenue))) {
      errors.push({ field: "revenu", message: "revenu must be a valid number" });
    } else if (Number(data.revenue) < 0) {
      errors.push({ field: "revenu", message: "revenu cannot be negative" });
    }
  }
  if (data.location !== undefined && !String(data.location).trim()) {
    errors.push({ field: "location", message: "location cannot be empty" });
  }

  return { data, errors };
}

function mapClientResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    companyName: row.company_name || row.name,
    companyEmail: row.email,
    address: row.address,
    industry: row.industry,
    AccountOwnerName: row.account_owner_name || row.name,
    companySize: row.company_size,
    revenu: row.revenue !== null && row.revenue !== undefined
      ? Number(row.revenue)
      : null,
    location: row.location,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =====================================================
// CREATE CLIENT
// POST /api/company/clients
// =====================================================
router.post("/", authorizeRole("company", "super_admin"), async (req, res, next) => {
  const { data, errors } = validateCreateClient(req.body);
  if (errors.length) {
    return sendError(res, 400, "Validation failed", errors);
  }

  const db = await pool.connect();
  try {
    const email = String(data.companyEmail).trim().toLowerCase();
    const companyName = String(data.companyName).trim();
    const ownerName = String(data.accountOwnerName).trim();

    const existing = await db.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    if (existing.rows[0]) {
      return sendError(res, 409, "A user with this companyEmail already exists");
    }

    await db.query("BEGIN");

    const passwordHash = await bcrypt.hash(String(data.password), 10);

    const { rows: userRows } = await db.query(
      `INSERT INTO users (name, email, password, role, company_id, status, created_at)
       VALUES ($1, $2, $3, 'client', $4, 'active', NOW())
       RETURNING id, name, email, role, status`,
      [ownerName, email, passwordHash, req.company.id],
    );

    const { rows: clientRows } = await db.query(
      `INSERT INTO clients (
         company_id, user_id, name, email, company_name, address, industry,
         account_owner_name, company_size, revenue, location, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
       RETURNING ${CLIENT_SELECT}`,
      [
        req.company.id,
        userRows[0].id,
        companyName,
        email,
        companyName,
        String(data.address).trim(),
        String(data.industry).trim(),
        ownerName,
        String(data.companySize).trim(),
        Number(data.revenue),
        String(data.location).trim(),
      ],
    );

    await db.query("COMMIT");

    return res.status(201).json({
      success: true,
      code: 201,
      message: "Client created successfully",
      companyId: req.company.id,
      data: {
        client: mapClientResponse(clientRows[0]),
        login: {
          email: userRows[0].email,
          role: userRows[0].role,
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
});

// =====================================================
// GET ALL CLIENTS (optionally for a specific company)
// GET /api/company/clients
// GET /api/company/clients?companyId=15
// Company role can only query their own companyId.
// =====================================================
router.get("/", async (req, res, next) => {
  try {
    let targetCompanyId = req.company.id;

    if (req.query.companyId !== undefined && req.query.companyId !== "") {
      const requestedId = Number.parseInt(req.query.companyId, 10);
      if (!Number.isInteger(requestedId) || requestedId <= 0) {
        return sendError(res, 400, "Invalid companyId");
      }

      // Company admins may only view their own company's clients
      if (req.user.role === "company" && requestedId !== Number(req.company.id)) {
        return sendError(
          res,
          403,
          "You can only view clients of your own company",
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
      `SELECT ${CLIENT_SELECT}
       FROM clients
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [targetCompanyId],
    );

    const clients = rows.map(mapClientResponse);

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Clients fetched successfully",
      count: clients.length,
      companyId: targetCompanyId,
      company: {
        id: companyCheck.rows[0].id,
        name: companyCheck.rows[0].name,
        email: companyCheck.rows[0].email,
        status: companyCheck.rows[0].status,
      },
      data: clients,
    });
  } catch (error) {
    next(error);
  }
});

// =====================================================
// GET SINGLE CLIENT
// GET /api/company/clients/:clientId
// =====================================================
router.get("/:clientId", async (req, res, next) => {
  try {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return sendError(res, 400, "Invalid client id");
    }

    const { rows } = await pool.query(
      `SELECT ${CLIENT_SELECT}
       FROM clients
       WHERE id = $1 AND company_id = $2`,
      [clientId, req.company.id],
    );

    if (!rows[0]) {
      return sendError(res, 404, "Client not found");
    }

    return sendSuccess(
      res,
      200,
      "Client fetched successfully",
      mapClientResponse(rows[0]),
    );
  } catch (error) {
    next(error);
  }
});

// =====================================================
// EDIT CLIENT
// PUT /api/company/clients/:clientId
// =====================================================
router.put(
  "/:clientId",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return sendError(res, 400, "Invalid client id");
    }

    const { data, errors } = validateUpdateClient(req.body);
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    const db = await pool.connect();
    try {
      const existing = await db.query(
        `SELECT ${CLIENT_SELECT}
         FROM clients
         WHERE id = $1 AND company_id = $2`,
        [clientId, req.company.id],
      );

      if (!existing.rows[0]) {
        return sendError(res, 404, "Client not found");
      }

      const current = existing.rows[0];
      const nextEmail =
        data.companyEmail !== undefined
          ? String(data.companyEmail).trim().toLowerCase()
          : current.email;

      if (nextEmail !== current.email) {
        const duplicate = await db.query(
          "SELECT id FROM users WHERE email = $1 AND id <> COALESCE($2, 0)",
          [nextEmail, current.user_id],
        );
        if (duplicate.rows[0]) {
          return sendError(
            res,
            409,
            "A user with this companyEmail already exists",
          );
        }
      }

      await db.query("BEGIN");

      const companyName =
        data.companyName !== undefined
          ? String(data.companyName).trim()
          : current.company_name || current.name;
      const ownerName =
        data.accountOwnerName !== undefined
          ? String(data.accountOwnerName).trim()
          : current.account_owner_name || current.name;

      const { rows } = await db.query(
        `UPDATE clients SET
           name = $1,
           email = $2,
           company_name = $3,
           address = COALESCE($4, address),
           industry = COALESCE($5, industry),
           account_owner_name = $6,
           company_size = COALESCE($7, company_size),
           revenue = COALESCE($8, revenue),
           location = COALESCE($9, location),
           updated_at = NOW()
         WHERE id = $10 AND company_id = $11
         RETURNING ${CLIENT_SELECT}`,
        [
          companyName,
          nextEmail,
          companyName,
          data.address !== undefined ? String(data.address).trim() : null,
          data.industry !== undefined ? String(data.industry).trim() : null,
          ownerName,
          data.companySize !== undefined
            ? String(data.companySize).trim()
            : null,
          data.revenue !== undefined && data.revenue !== ""
            ? Number(data.revenue)
            : null,
          data.location !== undefined ? String(data.location).trim() : null,
          clientId,
          req.company.id,
        ],
      );

      if (current.user_id) {
        const userUpdates = [];
        const userValues = [];

        if (data.accountOwnerName !== undefined) {
          userValues.push(ownerName);
          userUpdates.push(`name = $${userValues.length}`);
        }
        if (data.companyEmail !== undefined) {
          userValues.push(nextEmail);
          userUpdates.push(`email = $${userValues.length}`);
        }
        if (data.password !== undefined) {
          const passwordHash = await bcrypt.hash(String(data.password), 10);
          userValues.push(passwordHash);
          userUpdates.push(`password = $${userValues.length}`);
        }

        if (userUpdates.length) {
          userValues.push(current.user_id);
          await db.query(
            `UPDATE users SET ${userUpdates.join(", ")} WHERE id = $${userValues.length}`,
            userValues,
          );
        }
      }

      await db.query("COMMIT");

      return sendSuccess(
        res,
        200,
        "Client updated successfully",
        mapClientResponse(rows[0]),
      );
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
  },
);

// =====================================================
// DELETE CLIENT
// DELETE /api/company/clients/:clientId
// =====================================================
router.delete(
  "/:clientId",
  authorizeRole("company", "super_admin"),
  async (req, res, next) => {
    const clientId = Number.parseInt(req.params.clientId, 10);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      return sendError(res, 400, "Invalid client id");
    }

    const db = await pool.connect();
    try {
      const existing = await db.query(
        `SELECT id, user_id, company_name, name, email
         FROM clients
         WHERE id = $1 AND company_id = $2`,
        [clientId, req.company.id],
      );

      if (!existing.rows[0]) {
        return sendError(res, 404, "Client not found");
      }

      const current = existing.rows[0];

      await db.query("BEGIN");

      // Detach projects linked to this client before delete
      await db.query(
        `UPDATE projects SET client_id = NULL WHERE client_id = $1 AND company_id = $2`,
        [clientId, req.company.id],
      );

      await db.query(`DELETE FROM clients WHERE id = $1 AND company_id = $2`, [
        clientId,
        req.company.id,
      ]);

      if (current.user_id) {
        await db.query(
          `DELETE FROM users WHERE id = $1 AND role = 'client' AND company_id = $2`,
          [current.user_id, req.company.id],
        );
      }

      await db.query("COMMIT");

      return sendSuccess(res, 200, "Client deleted successfully", {
        id: current.id,
        companyName: current.company_name || current.name,
        companyEmail: current.email,
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
  },
);

// Method validation fallbacks
router.all("/", methodNotAllowed(["GET", "POST"]));
router.all("/:clientId", methodNotAllowed(["GET", "PUT", "DELETE"]));

module.exports = router;
