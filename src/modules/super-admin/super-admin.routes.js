const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../../config/db");
const protect = require("../../middleware/auth.middleware");
const authorize = require("../../middleware/role.middleware");

const router = express.Router();

// Apply super admin protection to all routes in this module
router.use(protect, authorize("super_admin"));

// Helper helper function to create a company and user with a specific role
async function createCompanyWithRole(req, res, next, defaultRole = "company") {
  const client = await pool.connect();

  try {
    const {
      companyName,
      ownerName,
      email,
      password,
      phone,
      address,
      industry,
      website,
      role,
      payment,
      paymentStatus,
    } = req.body;

    if (!companyName || !ownerName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Company name, owner name, email and password are required.",
      });
    }

    const targetRole = role || defaultRole;
    if (targetRole !== "company" && targetRole !== "team_leader") {
      return res.status(400).json({
        success: false,
        message:
          "Invalid role specified. Supported roles: 'company', 'team_leader'",
      });
    }

    await client.query("BEGIN");

    // Check duplicate email
    const emailExists = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()],
    );

    if (emailExists.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Email already exists.",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const paymentAmount = Number(payment) || 0;
    const paymentState = paymentStatus || "Pending";

    // Create company
    const companyResult = await client.query(
      `INSERT INTO companies
      (name,email,phone,address,industry,website,revenue,payment_status,status,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',NOW())
      RETURNING id,name,email,status,revenue,payment_status`,
      [
        companyName,
        email.toLowerCase(),
        phone || null,
        address || null,
        industry || null,
        website || null,
        paymentAmount,
        paymentState,
      ],
    );

    const company = companyResult.rows[0];

    // Create company admin user
    const userResult = await client.query(
      `INSERT INTO users
      (company_id,name,email,password,role,status,created_at)
      VALUES($1,$2,$3,$4,$5,'active',NOW())
      RETURNING id,name,email,role`,
      [company.id, ownerName, email.toLowerCase(), hashedPassword, targetRole],
    );

    const user = userResult.rows[0];

    // Set owner_id on company
    await client.query("UPDATE companies SET owner_id=$1 WHERE id=$2", [
      user.id,
      company.id,
    ]);

    if (paymentAmount > 0) {
      await client.query(
        `INSERT INTO revenues (company_id, amount, source, project_id, created_at)
         VALUES ($1, $2, $3, NULL, NOW())`,
        [company.id, paymentAmount, "Initial company payment"],
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Company created successfully.",
      data: {
        company,
        owner: user,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/super-admin/companies - Create a company and its owner
router.post("/companies", (req, res, next) =>
  createCompanyWithRole(req, res, next, "company"),
);

// POST /api/super-admin/team-leader-companies - Create a company and its team leader
router.post("/team-leader-companies", (req, res, next) =>
  createCompanyWithRole(req, res, next, "team_leader"),
);

// GET /api/super-admin/companies - data source for the company-management screen
router.get("/companies", async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.email AS company_email, c.phone, c.address, c.industry,
             c.website, c.status, c.revenue, c.payment_status,
             c.created_at,
             u.id AS owner_id, u.name AS owner_name, u.email AS owner_email,
             COUNT(members.id)::int AS employee_count
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      LEFT JOIN users members ON members.company_id = c.id
      GROUP BY c.id, u.id, u.name, u.email
      ORDER BY c.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/super-admin/companies/:id - update the fields that are stored for a tenant
router.patch("/companies/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      companyName,
      ownerName,
      phone,
      address,
      industry,
      website,
      status,
      payment,
      paymentStatus,
    } = req.body;
    const allowedStatuses = ["active", "inactive"];
    if (status && !allowedStatuses.includes(String(status).toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive.",
      });
    }
    await client.query("BEGIN");
    const company = await client.query(
      `UPDATE companies SET
        name = COALESCE(NULLIF($1, ''), name),
        phone = COALESCE($2, phone), address = COALESCE($3, address),
        industry = COALESCE($4, industry), website = COALESCE($5, website),
        status = COALESCE($6, status),
        revenue = COALESCE($7, revenue),
        payment_status = COALESCE(NULLIF($8, ''), payment_status)
       WHERE id = $9
       RETURNING id, name, email, phone, address, industry, website, status, revenue, payment_status, created_at`,
      [
        companyName?.trim(),
        phone,
        address,
        industry,
        website,
        status?.toLowerCase(),
        payment !== undefined ? Number(payment) : null,
        paymentStatus,
        req.params.id,
      ],
    );
    if (!company.rows[0]) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, message: "Company not found." });
    }
    if (ownerName?.trim()) {
      await client.query(
        "UPDATE users SET name = $1 WHERE id = (SELECT owner_id FROM companies WHERE id = $2)",
        [ownerName.trim(), req.params.id],
      );
    }
    await client.query("COMMIT");
    res.json({
      success: true,
      message: "Company updated successfully.",
      data: company.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

// PATCH /api/super-admin/companies/:id/status - quick account activation control
router.patch("/companies/:id/status", async (req, res, next) => {
  try {
    const status = String(req.body.status || "").toLowerCase();
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be active or inactive.",
      });
    }
    const { rows } = await pool.query(
      "UPDATE companies SET status = $1 WHERE id = $2 RETURNING id, status",
      [status, req.params.id],
    );
    if (!rows[0])
      return res
        .status(404)
        .json({ success: false, message: "Company not found." });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/companies/:companyId/clients
// Super admin: list clients of any specific company
router.get('/companies/:companyId/clients', async (req, res, next) => {
  try {
    const companyId = Number.parseInt(req.params.companyId, 10);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Invalid companyId',
      });
    }

    const companyResult = await pool.query(
      `SELECT id, name, email, status FROM companies WHERE id = $1`,
      [companyId]
    );

    if (!companyResult.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'Company not found',
      });
    }

    const { rows } = await pool.query(
      `SELECT
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
       FROM clients
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [companyId]
    );

    const clients = rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      userId: row.user_id,
      companyName: row.company_name || row.name,
      companyEmail: row.email,
      address: row.address,
      industry: row.industry,
      AccountOwnerName: row.account_owner_name || row.name,
      companySize: row.company_size,
      revenu:
        row.revenue !== null && row.revenue !== undefined
          ? Number(row.revenue)
          : null,
      location: row.location,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Clients fetched successfully',
      count: clients.length,
      companyId,
      company: companyResult.rows[0],
      data: clients,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/companies/:companyId/projects
// Super admin: list projects of any specific company
router.get('/companies/:companyId/projects', async (req, res, next) => {
  try {
    const companyId = Number.parseInt(req.params.companyId, 10);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Invalid companyId',
      });
    }

    const companyResult = await pool.query(
      `SELECT id, name, email, status FROM companies WHERE id = $1`,
      [companyId]
    );

    if (!companyResult.rows[0]) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'Company not found',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.company_id,
        p.name,
        p.description,
        p.status,
        p.client_id,
        p.team_id,
        p.project_leader_id,
        p.start_date,
        p.due_date,
        p.end_date,
        p.created_at,
        t.name AS team_name,
        u.name AS project_leader_name,
        cl.name AS client_name,
        cl.company_name AS client_company_name
      FROM projects p
      LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN users u ON u.id = p.project_leader_id
      LEFT JOIN clients cl ON cl.id = p.client_id
      WHERE p.company_id = $1
      ORDER BY p.created_at DESC
      `,
      [companyId]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Projects fetched successfully',
      count: rows.length,
      companyId,
      company: companyResult.rows[0],
      data: rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/dashboard - Super Admin Dashboard stats
router.get("/dashboard", async (req, res, next) => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM companies) AS total_companies,
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM companies WHERE status = 'active') AS active_companies
    `);

    const companiesResult = await pool.query(`
      SELECT c.id, c.name, c.email AS company_email, c.phone, c.industry, c.status,
             c.revenue, c.payment_status, c.created_at,
             u.name AS owner_name, u.email AS owner_email
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      dashboard: "super_admin",
      data: {
        stats: statsResult.rows[0],
        companies: companiesResult.rows,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
