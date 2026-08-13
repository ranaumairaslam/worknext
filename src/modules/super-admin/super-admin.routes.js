const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

// Apply super admin protection to all routes in this module
router.use(protect, authorize('super_admin'));

// Helper helper function to create a company and user with a specific role
async function createCompanyWithRole(req, res, next, defaultRole = 'company') {
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
      role
    } = req.body;

    if (!companyName || !ownerName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Company name, owner name, email and password are required."
      });
    }

    const targetRole = role || defaultRole;
    if (targetRole !== 'company' && targetRole !== 'team_leader') {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified. Supported roles: 'company', 'team_leader'"
      });
    }

    await client.query("BEGIN");

    // Check duplicate email
    const emailExists = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (emailExists.rows.length > 0) {
      await client.query("ROLLBACK");

      return res.status(400).json({
        success: false,
        message: "Email already exists."
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create company
    const companyResult = await client.query(
      `INSERT INTO companies
      (name,email,phone,address,industry,website,status,created_at)
      VALUES($1,$2,$3,$4,$5,$6,'active',NOW())
      RETURNING id,name,email,status`,
      [
        companyName,
        email.toLowerCase(),
        phone || null,
        address || null,
        industry || null,
        website || null
      ]
    );

    const company = companyResult.rows[0];

    // Create company admin user
    const userResult = await client.query(
      `INSERT INTO users
      (company_id,name,email,password,role,status,created_at)
      VALUES($1,$2,$3,$4,$5,'active',NOW())
      RETURNING id,name,email,role`,
      [
        company.id,
        ownerName,
        email.toLowerCase(),
        hashedPassword,
        targetRole
      ]
    );

    const user = userResult.rows[0];

    // Set owner_id on company
    await client.query(
      "UPDATE companies SET owner_id=$1 WHERE id=$2",
      [user.id, company.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Company created successfully.",
      data: {
        company,
        owner: user
      }
    });

  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
}

// POST /api/super-admin/companies - Create a company and its owner
router.post('/companies', (req, res, next) => createCompanyWithRole(req, res, next, 'company'));

// POST /api/super-admin/team-leader-companies - Create a company and its team leader
router.post('/team-leader-companies', (req, res, next) => createCompanyWithRole(req, res, next, 'team_leader'));

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

// GET /api/super-admin/companies/:companyId/employees
// Super admin: list employees of any specific company
router.get('/companies/:companyId/employees', async (req, res, next) => {
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
      `SELECT u.id, u.company_id, u.name, u.email, u.role, u.status, u.team_id, u.created_at,
              t.name AS team_name
       FROM users u
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE u.company_id = $1
         AND u.role IN ('team_leader', 'team_member')
       ORDER BY u.created_at DESC`,
      [companyId]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Employees fetched successfully',
      count: rows.length,
      companyId,
      company: companyResult.rows[0],
      data: rows.map((row) => ({
        id: row.id,
        EmployeeName: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        TeamId: row.team_id,
        teamName: row.team_name,
        companyId: row.company_id,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/super-admin/companies/:companyId/teams
// Super admin: list teams of any specific company
router.get('/companies/:companyId/teams', async (req, res, next) => {
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
      `SELECT t.id, t.name, t.description, t.created_at, t.updated_at,
              leader.id AS leader_id, leader.name AS leader_name, leader.email AS leader_email,
              COUNT(members.id)::int AS member_count
       FROM teams t
       LEFT JOIN users leader ON leader.id = t.leader_id
       LEFT JOIN users members ON members.team_id = t.id
       WHERE t.company_id = $1
       GROUP BY t.id, leader.id, leader.name, leader.email
       ORDER BY t.created_at DESC`,
      [companyId]
    );

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Teams fetched successfully',
      count: rows.length,
      companyId,
      company: companyResult.rows[0],
      data: rows,
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
router.get('/dashboard', async (req, res, next) => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM companies) AS total_companies,
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COUNT(*)::int FROM companies WHERE status = 'active') AS active_companies
    `);
    
    const companiesResult = await pool.query(`
      SELECT c.id, c.name, c.email AS company_email, c.phone, c.industry, c.status, c.created_at,
             u.name AS owner_name, u.email AS owner_email
      FROM companies c
      LEFT JOIN users u ON u.id = c.owner_id
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      dashboard: 'super_admin',
      data: {
        stats: statsResult.rows[0],
        companies: companiesResult.rows
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
