const express = require('express');
//const PDFDocument = require('pdfkit'); // npm install pdfkit
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

/**
 * ASSUMED SCHEMA (adjust column/table names to match your actual DB):
 *
 * users(id, name, email, password, role, company_id)
 * clients(id, user_id, company_id, name, email, created_at)
 * companies(id, name)
 * projects(id, company_id, name, description, status, start_date, end_date, created_at)
 * progress_reports(id, project_id, title, description, percentage, created_by, created_at)
 *
 * A client belongs to one company. A company can have many projects.
 * Progress reports belong to a project.
 */

// Small helper to load the client's profile + company from req.user.id
async function getClientProfile(userId) {
  const { rows } = await pool.query(
    `SELECT cl.id, cl.name, cl.email, cl.created_at,
            c.id AS company_id, c.name AS company_name
     FROM clients cl
     JOIN companies c ON c.id = cl.company_id
     WHERE cl.user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

// -----------------------------------------------------------------------
// COMPANY-SIDE ROUTE
// -----------------------------------------------------------------------

// POST /api/client-dashboard/clients -> /api/company/clients
// Company registers a new client AND creates their initial project in one request.
// Wrapped in a DB transaction so a partial failure can't leave orphaned rows.
router.post('/clients', protect, authorize('company'), async (req, res, next) => {
  const { name, email, password, project_name, project_description } = req.body;

  if (!name || !email || !password || !project_name) {
    return res.status(400).json({
      success: false,
      message: 'name, email, password, and project_name are required',
    });
  }

  const companyId = req.user.company_id; // assumes company_id is present on the authenticated company user
  if (!companyId) {
    return res.status(400).json({ success: false, message: 'Authenticated user has no company_id' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Prevent duplicate accounts on this email
    const { rows: existing } = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );
    if (existing[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'A user with this email already exists' });
    }

    // 2. Create the user account for the client
    //    NOTE: hash the password (e.g. bcrypt) before inserting in real code.
    const { rows: userRows } = await client.query(
      `INSERT INTO users (name, email, password, role, company_id)
       VALUES ($1, $2, $3, 'client', $4)
       RETURNING id`,
      [name, email, password, companyId]
    );
    const userId = userRows[0].id;

    // 3. Create the client profile, linked to the registering company
    const { rows: clientRows } = await client.query(
      `INSERT INTO clients (user_id, company_id, name, email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, company_id, created_at`,
      [userId, companyId, name, email]
    );
    const newClient = clientRows[0];

    // 4. Create the initial project for this company, using the name given at registration
    const { rows: projectRows } = await client.query(
  `INSERT INTO projects (
     company_id,
     client_id,
     name,
     description,
     status
   )
   VALUES ($1, $2, $3, $4, 'active')
   RETURNING
     id,
     name,
     description,
     status,
     start_date,
     end_date,
     created_at`,
  [
    req.company.id,
    clientRows[0].id,
    project_name.trim(),
    project_description
      ? project_description.trim()
      : null
  ]
);
    const newProject = projectRows[0];

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: { client: newClient, project: newProject },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// -----------------------------------------------------------------------
// CLIENT-SIDE ROUTES (unchanged from original)
// -----------------------------------------------------------------------

// GET /api/client-dashboard/dashboard -> /api/client/dashboard
// Overview: client profile + all projects (with progress summary) for their company
router.get('/dashboard', protect, authorize('client'), async (req, res, next) => {
  try {
    const client = await getClientProfile(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const { rows: projects } = await pool.query(
  `SELECT
      id,
      client_id,
      name,
      description,
      status,
      start_date,
      end_date,
      created_at
   FROM projects
   WHERE company_id = $1
   ORDER BY created_at DESC`,
  [req.company.id]
);

const data = clients.rows.map((client) => ({
  ...client,
  projects: projects.filter(
    (project) => project.client_id === client.id
  ),
}));

    res.json({
      success: true,
      dashboard: 'client',
      data: {
        client,
        projects_count: projects.length,
        projects,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/client-dashboard/projects -> /api/client/projects
// List all projects belonging to the client's company
router.get('/projects', protect, authorize('client'), async (req, res, next) => {
  try {
    const client = await getClientProfile(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const { rows: projects } = await pool.query(
      `SELECT id, name, description, status, start_date, end_date, created_at
       FROM projects
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [client.company_id]
    );

    res.json({ success: true, data: projects });
  } catch (error) {
    next(error);
  }
});

// GET /api/client-dashboard/projects/:id -> /api/client/projects/:id
// Full detail for a single project, ownership verified against the client's company
router.get('/projects/:id', protect, authorize('client'), async (req, res, next) => {
  try {
    const client = await getClientProfile(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    const { rows } = await pool.query(
      `SELECT id, name, description, status, start_date, end_date, created_at
       FROM projects
       WHERE id = $1 AND company_id = $2`,
      [req.params.id, client.company_id]
    );

    if (!rows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    next(error);
  }
});

// GET /api/client-dashboard/projects/:id/progress -> /api/client/projects/:id/progress
// All progress reports for a project, newest first
router.get('/projects/:id/progress', protect, authorize('client'), async (req, res, next) => {
  try {
    const client = await getClientProfile(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    // Verify the project belongs to this client's company before returning reports
    const { rows: projectRows } = await pool.query(
      `SELECT id, name FROM projects WHERE id = $1 AND company_id = $2`,
      [req.params.id, client.company_id]
    );

    if (!projectRows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    const { rows: reports } = await pool.query(
      `SELECT id, title, description, percentage, created_at
       FROM progress_reports
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        project: projectRows[0],
        reports,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/client-dashboard/projects/:id/progress/download -> /api/client/projects/:id/progress/download
// Streams a PDF of the project's progress reports for the client to download
router.get('/projects/:id/progress/download', protect, authorize('client'), async (req, res, next) => {
  try {
    const client = await getClientProfile(req.user.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client profile not found' });
    }

    // Verify the project belongs to this client's company before generating anything
    const { rows: projectRows } = await pool.query(
      `SELECT id, name, description, status, start_date, end_date
       FROM projects
       WHERE id = $1 AND company_id = $2`,
      [req.params.id, client.company_id]
    );

    if (!projectRows[0]) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }
    const project = projectRows[0];

    const { rows: reports } = await pool.query(
      `SELECT title, description, percentage, created_at
       FROM progress_reports
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    // Set headers before streaming so the browser treats this as a file download
    const safeName = project.name.replace(/[^a-z0-9_\-]+/gi, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="progress-report-${safeName}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res); // stream directly to the response, no temp file needed

    // Header
    doc.fontSize(20).text('Project Progress Report', { align: 'center' });
    doc.moveDown();

    // Project info
    doc.fontSize(14).text(project.name, { underline: true });
    doc.fontSize(10).fillColor('#555').text(`Status: ${project.status || 'N/A'}`);
    if (project.start_date || project.end_date) {
      doc.text(
        `Timeline: ${project.start_date ? new Date(project.start_date).toDateString() : 'N/A'}` +
        ` - ${project.end_date ? new Date(project.end_date).toDateString() : 'Ongoing'}`
      );
    }
    doc.moveDown(0.5);
    doc.fillColor('#000').fontSize(11).text(project.description || 'No description provided.');
    doc.moveDown();

    doc.fontSize(9).fillColor('#888')
      .text(`Generated for: ${client.name} (${client.email})`)
      .text(`Generated on: ${new Date().toDateString()}`);
    doc.moveDown();

    // Divider
    doc.strokeColor('#ccc').moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // Progress reports
    doc.fillColor('#000').fontSize(14).text('Progress Reports', { underline: true });
    doc.moveDown(0.5);

    if (reports.length === 0) {
      doc.fontSize(11).fillColor('#555').text('No progress reports have been added yet.');
    } else {
      reports.forEach((report, index) => {
        doc.fontSize(12).fillColor('#000').text(`${index + 1}. ${report.title}`);
        doc.fontSize(10).fillColor('#555')
          .text(`Progress: ${report.percentage != null ? report.percentage + '%' : 'N/A'}`)
          .text(`Date: ${new Date(report.created_at).toDateString()}`);
        if (report.description) {
          doc.fontSize(10).fillColor('#000').text(report.description);
        }
        doc.moveDown();
      });
    }

    doc.end(); // finalizes the PDF and closes the response stream
  } catch (error) {
    next(error);
  }
});

module.exports = router;