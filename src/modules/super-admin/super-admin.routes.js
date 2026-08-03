const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

// Apply super admin protection to all routes in this module
router.use(protect, authorize('super_admin'));

// POST /api/super-admin/companies - Create a company and its owner
router.post('/companies', async (req, res, next) => {
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
      website
    } = req.body;

    if (!companyName || !ownerName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Company name, owner name, email and password are required."
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
      VALUES($1,$2,$3,$4,'company','active',NOW())
      RETURNING id,name,email,role`,
      [
        company.id,
        ownerName,
        email.toLowerCase(),
        hashedPassword
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
