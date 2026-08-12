const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const router = express.Router();

// GET /api/client/dashboard
router.get(
  '/dashboard',
  protect,
  authorize('client'),
  async (req, res, next) => {
    try {
      const clientQuery = `
        SELECT
          cl.id,
          cl.name,
          cl.email,
          cl.created_at,
          c.id AS company_id,
          c.name AS company_name
        FROM clients cl
        JOIN companies c ON c.id = cl.company_id
        WHERE cl.user_id = $1
      `;

      const { rows: clientRows } = await pool.query(clientQuery, [req.user.id]);

      if (!clientRows[0]) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      const client = clientRows[0];

      const meetingsQuery = `
        SELECT
          m.id,
          m.title,
          m.description,
          m.scheduled_at,
          m.meeting_link,
          m.status,
          m.created_at,
          c.name AS company_name
        FROM meetings m
        JOIN companies c ON c.id = m.company_id
        WHERE m.client_id = $1
          AND m.company_id = $2
        ORDER BY m.scheduled_at ASC
      `;

      const { rows: meetings } = await pool.query(meetingsQuery, [
        client.id,
        client.company_id,
      ]);

      res.json({
        success: true,
        dashboard: 'client',
        data: {
          client: {
            id: client.id,
            name: client.name,
            email: client.email,
            company_id: client.company_id,
            company_name: client.company_name,
            created_at: client.created_at,
          },
          meetings,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/client/projects
router.get(
  '/projects',
  protect,
  authorize('client'),
  async (req, res, next) => {
    try {
      const query = `
        SELECT
          p.id,
          p.name,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          p.created_at,
          COUNT(t.id)::int AS total_tasks,
          COUNT(
            CASE WHEN LOWER(t.status) IN ('completed', 'done') THEN 1 END
          )::int AS completed_tasks,
          COUNT(
            CASE WHEN LOWER(t.status) IN ('in progress', 'in_progress') THEN 1 END
          )::int AS in_progress_tasks,
          COUNT(
            CASE WHEN LOWER(t.status) IN ('pending', 'todo') THEN 1 END
          )::int AS pending_tasks,
          CASE
            WHEN COUNT(t.id) = 0 THEN 0
            ELSE ROUND(
              (
                COUNT(
                  CASE WHEN LOWER(t.status) IN ('completed', 'done') THEN 1 END
                ) * 100.0
              ) / COUNT(t.id)
            )
          END AS progress
        FROM projects p
        JOIN clients cl ON cl.id = p.client_id
        LEFT JOIN tasks t ON t.project_id = p.id
        WHERE cl.user_id = $1
        GROUP BY
          p.id,
          p.name,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          p.created_at
        ORDER BY p.created_at DESC
      `;

      const { rows } = await pool.query(query, [req.user.id]);

      res.json({
        success: true,
        projects: rows,
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
