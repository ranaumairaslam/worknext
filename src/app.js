require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const pool = require('./config/db');
const protect = require('./middleware/auth.middleware');
const authorize = require('./middleware/role.middleware');

const app = express();

// =======================
// Middleware
// =======================

const allowedOrigins = (
  process.env.CLIENT_URL ||
  'http://localhost:3000,http://127.0.0.1:3000'
)
  .split(',')
  .map(origin => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('This origin is not allowed by CORS'));
    },
    credentials: true,
  })
);

app.use(express.json());

// =======================
// LOGIN API
// =======================

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' });

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });

    await pool.query('UPDATE users SET token=$1, last_login=NOW() WHERE id=$2', [token, user.id]);

    res.status(200).json({ success: true, message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    console.error('LOGIN ERROR:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// =======================
// COMPANY SIGNUP API
// =======================

const companyPayload = (body) => ({
  companyName: body.companyName?.trim(),
  name: body.name?.trim(),
  email: body.email?.trim().toLowerCase(),
  password: body.password,
  phone: body.phone?.trim() || null,
  address: body.address?.trim() || null,
  industry: body.industry?.trim() || null,
  website: body.website?.trim() || null,
});

const validateCompanyPayload = (company) => {
  if (!company.companyName || !company.name || !company.email || !company.password) return 'Company name, contact name, email, and password are required';
  if (!/^\S+@\S+\.\S+$/.test(company.email)) return 'Please provide a valid email address';
  if (company.password.length < 6) return 'Password must be at least 6 characters long';
  return null;
};

async function createCompanyAccount(data) {
  const company = companyPayload(data);
  const err = validateCompanyPayload(company);
  if (err) {
    const e = new Error(err);
    e.statusCode = 400;
    throw e;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [company.email]);
    if (existing.rows[0]) {
      const e = new Error('An account with this email already exists');
      e.statusCode = 409;
      throw e;
    }
    const passwordHash = await bcrypt.hash(company.password, 10);
    const user = await client.query("INSERT INTO users (name, email, password, role) VALUES ($1,$2,$3,'company') RETURNING id, name, email, role, created_at", [company.name, company.email, passwordHash]);
    const createdCompany = await client.query('INSERT INTO companies (name, owner_id, email, phone, address, industry, website) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, name, owner_id, email, phone, address, industry, website, status, created_at, updated_at', [company.companyName, user.rows[0].id, company.email, company.phone, company.address, company.industry, company.website]);
    await client.query('UPDATE users SET company_id = $1 WHERE id = $2', [createdCompany.rows[0].id, user.rows[0].id]);
    await client.query('COMMIT');
    return { user: user.rows[0], company: createdCompany.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

app.post('/api/company/signup', async (req, res, next) => {
  try {
    const account = await createCompanyAccount(req.body);
    res.status(201).json({ success: true, message: 'Company registered successfully', data: account });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
});

// Temporary helper for local testing of protected routes
app.post('/api/dev/super-admin-token', (req, res) => {
  const token = jwt.sign(
    { id: 9999, email: 'super-admin@local.test', role: 'super_admin' },
    process.env.JWT_SECRET || 'dev-super-admin-secret',
    { expiresIn: '1h' }
  );

  res.status(200).json({ success: true, message: 'Temporary super-admin token created', token });
});

// =======================
// DASHBOARD / ADMIN routes (super-admin etc.)
// =======================

app.post('/api/super-admin/companies', protect, authorize('super_admin'), async (req, res, next) => {
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

    // Create company admin
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

    // Set owner_id
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

// Mount company-scoped routes
app.use('/api', require('./routes'));

// Team Leader Dashboard: GET /api/team-leader/dashboard
app.get('/api/team-leader/dashboard', protect, authorize('team_leader'), async (req, res, next) => {
  try {

    
    const { rows: teams } = await pool.query('SELECT id, name, company_id, created_at FROM teams WHERE leader_id = $1 ORDER BY created_at DESC', [req.user.id]);
    const teamIds = teams.map((team) => team.id);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS total_members FROM users WHERE team_id = ANY($1::int[])', [teamIds]);
    res.json({ success: true, dashboard: 'team_leader', data: { teams, total_teams: teams.length, total_members: rows[0].total_members } });
  } catch (error) { next(error); }
});

// Team Member Dashboard: GET /api/team-member/dashboard
app.get('/api/team-member/', protect, authorize('team_member'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.role, t.id AS team_id, t.name AS team_name, c.id AS company_id, c.name AS company_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      LEFT JOIN companies c ON c.id = COALESCE(u.company_id, t.company_id)
      WHERE u.id = $1
    `, [req.user.id]);
    res.json({ success: true, dashboard: 'team_member', data: rows[0] || null });
  } catch (error) { next(error); }
});

// Client Dashboard: GET /api/client/dashboard
app.get('/api/client/dashboard', protect, authorize('client'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT cl.id, cl.name, cl.email, cl.created_at, c.id AS company_id, c.name AS company_name
      FROM clients cl
      JOIN companies c ON c.id = cl.company_id
      WHERE cl.user_id = $1
    `, [req.user.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Client profile not found' });
    res.json({ success: true, dashboard: 'client', data: rows[0] });
  } catch (error) { next(error); }
});

// =======================
// Home Route
// =======================
app.get('/', (req, res) => res.json({ success: true, message: 'Auth API is running' }));

// 404 Handler
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// Error Handler
app.use(require('./middleware/error.middleware'));

module.exports = app;
