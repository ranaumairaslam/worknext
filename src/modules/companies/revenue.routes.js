const express = require("express");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

const ALLOWED_STATUSES = ["pending", "complete"];
const COLLECTION_METHODS = ["GET", "POST"];
const ITEM_METHODS = ["GET", "PUT", "PATCH", "DELETE"];

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

const parseRevenueId = (raw) => {
  const value = String(raw || "").trim();
  const matched = value.match(/^(?:revenueId[:/])?(\d+)$/i);
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

function pickRevenueBody(body = {}) {
  return {
    projectName: body.ProjectName ?? body.projectName ?? null,
    projectId: body.projectId ?? body.ProjectId ?? null,
    amount: body.Amount ?? body.amount ?? null,
    date: body.Date ?? body.date ?? null,
    status: body.status ?? body.Status ?? null,
    clientName: body.ClientName ?? body.clientName ?? null,
    clientId: body.clientId ?? body.ClientId ?? null,
  };
}

function normalizeDate(date) {
  if (date === null || date === undefined || String(date).trim() === "") {
    return null;
  }
  const value = String(date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function normalizeStatus(status) {
  if (status === null || status === undefined || String(status).trim() === "") {
    return null;
  }
  const key = String(status).trim().toLowerCase();
  if (key === "pending") return "pending";
  if (key === "complete" || key === "completed" || key === "done") {
    return "complete";
  }
  return null;
}

async function resolveProject(db, companyId, { projectName, projectId }) {
  if (
    projectId !== null &&
    projectId !== undefined &&
    String(projectId).trim() !== ""
  ) {
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

  return {
    error: {
      field: "ProjectName",
      message: "ProjectName (or projectId) is required",
    },
  };
}

async function resolveClient(db, companyId, { clientName, clientId }) {
  if (
    clientId !== null &&
    clientId !== undefined &&
    String(clientId).trim() !== ""
  ) {
    const id = Number.parseInt(clientId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return { error: { field: "clientId", message: "Invalid clientId" } };
    }
    const { rows } = await db.query(
      `SELECT id, name, company_name, email
       FROM clients WHERE id = $1 AND company_id = $2`,
      [id, companyId],
    );
    if (!rows[0]) {
      return { error: { field: "clientId", message: "Client not found" } };
    }
    return { client: rows[0] };
  }

  if (clientName && String(clientName).trim()) {
    const name = String(clientName).trim();
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.company_name, c.email
       FROM clients c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.company_id = $1
         AND (
           LOWER(c.name) = LOWER($2)
           OR LOWER(COALESCE(c.company_name, '')) = LOWER($2)
           OR LOWER(COALESCE(c.email, '')) = LOWER($2)
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

  return {
    error: {
      field: "ClientName",
      message: "ClientName (or clientId) is required",
    },
  };
}

async function fetchRevenueById(companyId, revenueId) {
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      r.amount AS "Amount",
      r.revenue_date AS "Date",
      r.status,
      r.project_id,
      p.name AS "ProjectName",
      r.client_id,
      COALESCE(c.name, c.company_name) AS "ClientName",
      c.email AS client_email,
      r.created_at,
      r.updated_at
    FROM revenues r
    LEFT JOIN projects p ON p.id = r.project_id
    LEFT JOIN clients c ON c.id = r.client_id
    WHERE r.id = $1 AND r.company_id = $2
    `,
    [revenueId, companyId],
  );
  return rows[0] || null;
}

function validateCreate(data) {
  const errors = [];
  if (
    (!data.projectName || !String(data.projectName).trim()) &&
    (data.projectId === null || data.projectId === undefined || data.projectId === "")
  ) {
    errors.push({
      field: "ProjectName",
      message: "ProjectName is required",
    });
  }

  const amount = Number(data.amount);
  if (data.amount === null || data.amount === undefined || data.amount === "") {
    errors.push({ field: "Amount", message: "Amount is required" });
  } else if (Number.isNaN(amount)) {
    errors.push({ field: "Amount", message: "Amount must be a number" });
  } else if (amount < 0) {
    errors.push({ field: "Amount", message: "Amount cannot be negative" });
  }

  const date = normalizeDate(data.date);
  if (!date) {
    errors.push({
      field: "Date",
      message: "Date is required (YYYY-MM-DD)",
    });
  }

  const status = normalizeStatus(data.status);
  if (!data.status || !String(data.status).trim()) {
    errors.push({
      field: "status",
      message: "status is required (pending or complete)",
    });
  } else if (!status) {
    errors.push({
      field: "status",
      message: "status must be pending or complete",
    });
  }

  if (
    (!data.clientName || !String(data.clientName).trim()) &&
    (data.clientId === null || data.clientId === undefined || data.clientId === "")
  ) {
    errors.push({
      field: "ClientName",
      message: "ClientName is required",
    });
  }

  return { errors, amount, date, status };
}

// =====================================================
// CREATE Project Revenue
// POST /api/company/revenues
// POST /api/company/project-revenues
// =====================================================
async function createRevenueHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const data = pickRevenueBody(req.body || {});
    const { errors, amount, date, status } = validateCreate(data);
    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    await db.query("BEGIN");

    const projectResult = await resolveProject(db, req.company.id, data);
    if (projectResult.error) {
      await db.query("ROLLBACK");
      return sendError(res, 404, projectResult.error.message, [
        projectResult.error,
      ]);
    }

    const clientResult = await resolveClient(db, req.company.id, data);
    if (clientResult.error) {
      await db.query("ROLLBACK");
      return sendError(res, 404, clientResult.error.message, [
        clientResult.error,
      ]);
    }

    const { rows } = await db.query(
      `
      INSERT INTO revenues (
        company_id, project_id, client_id, amount, revenue_date, status, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        req.company.id,
        projectResult.project.id,
        clientResult.client.id,
        amount,
        date,
        status,
        projectResult.project.name,
      ],
    );

    await db.query("COMMIT");

    const revenue = await fetchRevenueById(req.company.id, rows[0].id);
    return res.status(201).json({
      success: true,
      code: 201,
      message: "Project revenue created successfully",
      data: revenue,
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

router.post("/", canManage, createRevenueHandler);
router.post("/create", canManage, createRevenueHandler);
router.all("/create", methodNotAllowed(["POST"]));

// =====================================================
// LIST + GET
// =====================================================
router.get("/", async (req, res, next) => {
  try {
    const status = normalizeStatus(req.query.status);
    const values = [req.company.id];
    let statusClause = "";
    if (status) {
      values.push(status);
      statusClause = ` AND r.status = $${values.length}`;
    }

    const { rows } = await pool.query(
      `
      SELECT
        r.id,
        r.amount AS "Amount",
        r.revenue_date AS "Date",
        r.status,
        r.project_id,
        p.name AS "ProjectName",
        r.client_id,
        COALESCE(c.name, c.company_name) AS "ClientName",
        r.created_at,
        r.updated_at
      FROM revenues r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN clients c ON c.id = r.client_id
      WHERE r.company_id = $1
      ${statusClause}
      ORDER BY r.revenue_date DESC NULLS LAST, r.created_at DESC
      `,
      values,
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project revenues fetched successfully",
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

async function getRevenueHandler(req, res, next) {
  try {
    const revenueId = parseRevenueId(req.params.revenueId);
    if (!revenueId) {
      return sendError(res, 400, "Invalid revenue id", [
        {
          field: "revenueId",
          message: "Use /revenues/12 or /revenues/revenueId:12",
        },
      ]);
    }

    const revenue = await fetchRevenueById(req.company.id, revenueId);
    if (!revenue) return sendError(res, 404, "Project revenue not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project revenue fetched successfully",
      data: revenue,
    });
  } catch (error) {
    next(error);
  }
}

router.get("/revenueId/:revenueId", getRevenueHandler);
router.get("/:revenueId", getRevenueHandler);

// =====================================================
// EDIT
// =====================================================
async function updateRevenueHandler(req, res, next) {
  const db = await pool.connect();
  try {
    const revenueId = parseRevenueId(req.params.revenueId);
    if (!revenueId) {
      return sendError(res, 400, "Invalid revenue id");
    }

    const existing = await db.query(
      `SELECT id FROM revenues WHERE id = $1 AND company_id = $2`,
      [revenueId, req.company.id],
    );
    if (!existing.rows[0]) {
      return sendError(res, 404, "Project revenue not found");
    }

    const data = pickRevenueBody(req.body || {});
    const errors = [];

    let amount = undefined;
    if (data.amount !== null && data.amount !== undefined && data.amount !== "") {
      amount = Number(data.amount);
      if (Number.isNaN(amount)) {
        errors.push({ field: "Amount", message: "Amount must be a number" });
      } else if (amount < 0) {
        errors.push({ field: "Amount", message: "Amount cannot be negative" });
      }
    }

    let date = undefined;
    if (data.date !== null && data.date !== undefined && data.date !== "") {
      date = normalizeDate(data.date);
      if (!date) {
        errors.push({ field: "Date", message: "Date must be YYYY-MM-DD" });
      }
    }

    let status = undefined;
    if (data.status !== null && data.status !== undefined && data.status !== "") {
      status = normalizeStatus(data.status);
      if (!status) {
        errors.push({
          field: "status",
          message: "status must be pending or complete",
        });
      }
    }

    if (errors.length) {
      return sendError(res, 400, "Validation failed", errors);
    }

    await db.query("BEGIN");

    let projectId = undefined;
    let projectName = undefined;
    if (
      (data.projectName && String(data.projectName).trim()) ||
      (data.projectId !== null &&
        data.projectId !== undefined &&
        data.projectId !== "")
    ) {
      const projectResult = await resolveProject(db, req.company.id, data);
      if (projectResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, projectResult.error.message, [
          projectResult.error,
        ]);
      }
      projectId = projectResult.project.id;
      projectName = projectResult.project.name;
    }

    let clientId = undefined;
    if (
      (data.clientName && String(data.clientName).trim()) ||
      (data.clientId !== null &&
        data.clientId !== undefined &&
        data.clientId !== "")
    ) {
      const clientResult = await resolveClient(db, req.company.id, data);
      if (clientResult.error) {
        await db.query("ROLLBACK");
        return sendError(res, 404, clientResult.error.message, [
          clientResult.error,
        ]);
      }
      clientId = clientResult.client.id;
    }

    await db.query(
      `
      UPDATE revenues SET
        amount = COALESCE($1, amount),
        revenue_date = COALESCE($2, revenue_date),
        status = COALESCE($3, status),
        project_id = CASE WHEN $4::boolean THEN $5 ELSE project_id END,
        client_id = CASE WHEN $6::boolean THEN $7 ELSE client_id END,
        source = COALESCE($8, source),
        updated_at = NOW()
      WHERE id = $9 AND company_id = $10
      `,
      [
        amount ?? null,
        date ?? null,
        status ?? null,
        projectId !== undefined,
        projectId ?? null,
        clientId !== undefined,
        clientId ?? null,
        projectName ?? null,
        revenueId,
        req.company.id,
      ],
    );

    await db.query("COMMIT");

    const revenue = await fetchRevenueById(req.company.id, revenueId);
    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project revenue updated successfully",
      data: revenue,
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

router.patch("/edit/:revenueId", canManage, updateRevenueHandler);
router.put("/edit/:revenueId", canManage, updateRevenueHandler);
router.post("/edit/:revenueId", canManage, updateRevenueHandler);
router.all("/edit/:revenueId", methodNotAllowed(["PUT", "PATCH", "POST"]));

router.post("/edit", canManage, async (req, res, next) => {
  const body = req.body || {};
  const revenueId = parseRevenueId(body.revenueId ?? body.RevenueId ?? body.id);
  if (!revenueId) {
    return sendError(res, 400, "revenueId is required", [
      { field: "revenueId", message: "Pass revenueId in body to edit" },
    ]);
  }
  req.params.revenueId = String(revenueId);
  return updateRevenueHandler(req, res, next);
});
router.all("/edit", methodNotAllowed(["POST"]));

router.patch("/revenueId/:revenueId", canManage, updateRevenueHandler);
router.put("/revenueId/:revenueId", canManage, updateRevenueHandler);
router.delete(
  "/revenueId/:revenueId",
  canManage,
  async (req, res, next) => {
    req.params.revenueId = req.params.revenueId;
    return deleteRevenueHandler(req, res, next);
  },
);
router.all(
  "/revenueId/:revenueId",
  methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]),
);

// =====================================================
// DELETE
// =====================================================
async function deleteRevenueHandler(req, res, next) {
  try {
    const revenueId = parseRevenueId(req.params.revenueId);
    if (!revenueId) {
      return sendError(res, 400, "Invalid revenue id");
    }

    const { rows } = await pool.query(
      `DELETE FROM revenues
       WHERE id = $1 AND company_id = $2
       RETURNING id, amount, status`,
      [revenueId, req.company.id],
    );

    if (!rows[0]) return sendError(res, 404, "Project revenue not found");

    return res.status(200).json({
      success: true,
      code: 200,
      message: "Project revenue deleted successfully",
      data: rows[0],
    });
  } catch (error) {
    next(error);
  }
}

router.delete("/delete/:revenueId", canManage, deleteRevenueHandler);
router.all("/delete/:revenueId", methodNotAllowed(["DELETE"]));

router.patch("/:revenueId", canManage, updateRevenueHandler);
router.put("/:revenueId", canManage, updateRevenueHandler);
router.delete("/:revenueId", canManage, deleteRevenueHandler);

router.all("/", methodNotAllowed(COLLECTION_METHODS));
router.all("/:revenueId", methodNotAllowed(ITEM_METHODS));

module.exports = router;
