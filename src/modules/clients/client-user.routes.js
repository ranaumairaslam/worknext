const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Client Role Authorization
|--------------------------------------------------------------------------
*/


const authorizeClient = (req, res, next) => {
  if (!req.user || req.user.role !== 'client') {
    return res.status(403).json({
      success: false,
      message: 'Client access required',
    });
  }

  next();
};

/*
|--------------------------------------------------------------------------
| Apply authentication + client authorization
|--------------------------------------------------------------------------
*/

router.use(protect);
router.use(authorizeClient);

/*
|--------------------------------------------------------------------------
| Helper: Get logged-in client
|--------------------------------------------------------------------------
*/

const getClient = async (userId) => {
  const { rows } = await pool.query(
    `
    SELECT
      cl.id,
      cl.name,
      cl.email,
      cl.company_id,
      cl.user_id,
      cl.created_at,

      c.name AS company_name

    FROM clients cl

    INNER JOIN companies c
      ON c.id = cl.company_id

    WHERE cl.user_id = $1
    `,
    [userId]
  );

  return rows[0] || null;
};

/*
|--------------------------------------------------------------------------
| GET /api/client/dashboard
|--------------------------------------------------------------------------
| Complete client dashboard
|
| Returns:
| - Client information
| - Company information
| - Project summary
| - Upcoming meetings
| - Project progress
|--------------------------------------------------------------------------
*/

router.get('/dashboard', async (req, res, next) => {
  try {
    const client = await getClient(req.user.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Project Summary
    |--------------------------------------------------------------------------
    */

    const { rows: projectSummaryRows } = await pool.query(
      `
      SELECT
        COUNT(*)::int AS total_projects,

        COUNT(*) FILTER (
          WHERE LOWER(status) IN ('active', 'in_progress', 'in progress')
        )::int AS active_projects,

        COUNT(*) FILTER (
          WHERE LOWER(status) IN ('completed', 'complete', 'done')
        )::int AS completed_projects,

        COUNT(*) FILTER (
          WHERE LOWER(status) IN ('pending', 'todo')
        )::int AS pending_projects

      FROM projects

      WHERE client_id = $1
        AND company_id = $2
      `,
      [client.id, client.company_id]
    );

    /*
    |--------------------------------------------------------------------------
    | Upcoming Meetings
    |--------------------------------------------------------------------------
    */

    const { rows: meetings } = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.description,
        m.scheduled_at,
        m.meeting_link,
        m.status,
        m.project_id,
        p.name AS project_name

      FROM meetings m

      LEFT JOIN projects p
        ON p.id = m.project_id

      WHERE m.client_id = $1
        AND m.company_id = $2
        AND m.scheduled_at >= NOW()
        AND LOWER(m.status) NOT IN ('cancelled', 'canceled')

      ORDER BY m.scheduled_at ASC

      LIMIT 5
      `,
      [client.id, client.company_id]
    );

    /*
    |--------------------------------------------------------------------------
    | Projects With Progress
    |--------------------------------------------------------------------------
    */

    const { rows: projects } = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at,

        COUNT(t.id)::int AS total_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('completed', 'done')
        )::int AS completed_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('in_progress', 'in progress')
        )::int AS in_progress_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('todo', 'pending')
        )::int AS pending_tasks,

        CASE
          WHEN COUNT(t.id) = 0 THEN 0
          ELSE ROUND(
            (
              COUNT(t.id) FILTER (
                WHERE LOWER(t.status) IN ('completed', 'done')
              ) * 100.0
            ) / COUNT(t.id)
          )
        END AS progress

      FROM projects p

      LEFT JOIN tasks t
        ON t.project_id = p.id

      WHERE p.client_id = $1
        AND p.company_id = $2

      GROUP BY
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at

      ORDER BY p.created_at DESC
      `,
      [client.id, client.company_id]
    );

    /*
    |--------------------------------------------------------------------------
    | Dashboard Response
    |--------------------------------------------------------------------------
    */

    return res.json({
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

        summary: projectSummaryRows[0],

        projects,

        upcoming_meetings: meetings,
      },
    });
  } catch (error) {
    next(error);
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/client/profile
|--------------------------------------------------------------------------
| Get logged-in client profile
|--------------------------------------------------------------------------
*/

router.get('/profile', async (req, res, next) => {
  try {
    const client = await getClient(req.user.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
      });
    }

    return res.json({
      success: true,
      data: client,
    });
  } catch (error) {
    next(error);
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/client/projects
|--------------------------------------------------------------------------
| Get all projects belonging ONLY to logged-in client
|--------------------------------------------------------------------------
*/

router.get('/projects', async (req, res, next) => {
  try {
    const client = await getClient(req.user.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at,

        COUNT(t.id)::int AS total_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('completed', 'done')
        )::int AS completed_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('in_progress', 'in progress')
        )::int AS in_progress_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('todo', 'pending')
        )::int AS pending_tasks,

        CASE
          WHEN COUNT(t.id) = 0 THEN 0
          ELSE ROUND(
            (
              COUNT(t.id) FILTER (
                WHERE LOWER(t.status) IN ('completed', 'done')
              ) * 100.0
            ) / COUNT(t.id)
          )
        END AS progress

      FROM projects p

      LEFT JOIN tasks t
        ON t.project_id = p.id

      WHERE p.client_id = $1
        AND p.company_id = $2

      GROUP BY
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at

      ORDER BY p.created_at DESC
      `,
      [client.id, client.company_id]
    );

    return res.json({
      success: true,
      projects: rows,
    });
  } catch (error) {
    next(error);
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/client/projects/:projectId
|--------------------------------------------------------------------------
| Get a single project
|--------------------------------------------------------------------------
*/

router.get('/projects/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;

    const client = await getClient(req.user.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at,

        COUNT(t.id)::int AS total_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('completed', 'done')
        )::int AS completed_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('in_progress', 'in progress')
        )::int AS in_progress_tasks,

        COUNT(t.id) FILTER (
          WHERE LOWER(t.status) IN ('todo', 'pending')
        )::int AS pending_tasks,

        CASE
          WHEN COUNT(t.id) = 0 THEN 0
          ELSE ROUND(
            (
              COUNT(t.id) FILTER (
                WHERE LOWER(t.status) IN ('completed', 'done')
              ) * 100.0
            ) / COUNT(t.id)
          )
        END AS progress

      FROM projects p

      LEFT JOIN tasks t
        ON t.project_id = p.id

      WHERE p.id = $1
        AND p.client_id = $2
        AND p.company_id = $3

      GROUP BY
        p.id,
        p.name,
        p.description,
        p.status,
        p.start_date,
        p.end_date,
        p.created_at
      `,
      [
        projectId,
        client.id,
        client.company_id,
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        message: 'Project not found',
      });
    }

    return res.json({
      success: true,
      project: rows[0],
    });
  } catch (error) {
    next(error);
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/client/projects/:projectId/progress
|--------------------------------------------------------------------------
| Detailed project progress
|--------------------------------------------------------------------------
*/

router.get(
  '/projects/:projectId/progress',
  async (req, res, next) => {
    try {
      const { projectId } = req.params;

      const client = await getClient(req.user.id);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Project
      |--------------------------------------------------------------------------
      */

      const { rows: projectRows } = await pool.query(
        `
        SELECT
          p.id,
          p.name,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          p.created_at

        FROM projects p

        WHERE p.id = $1
          AND p.client_id = $2
          AND p.company_id = $3
        `,
        [
          projectId,
          client.id,
          client.company_id,
        ]
      );

      if (!projectRows[0]) {
        return res.status(404).json({
          success: false,
          message: 'Project not found',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Task statistics
      |--------------------------------------------------------------------------
      */

      const { rows: statsRows } = await pool.query(
        `
        SELECT
          COUNT(*)::int AS total_tasks,

          COUNT(*) FILTER (
            WHERE LOWER(status) IN ('completed', 'done')
          )::int AS completed_tasks,

          COUNT(*) FILTER (
            WHERE LOWER(status) IN ('in_progress', 'in progress')
          )::int AS in_progress_tasks,

          COUNT(*) FILTER (
            WHERE LOWER(status) IN ('todo', 'pending')
          )::int AS pending_tasks,

          COUNT(*) FILTER (
            WHERE due_date < NOW()
              AND LOWER(status) NOT IN ('completed', 'done')
          )::int AS overdue_tasks

        FROM tasks

        WHERE project_id = $1
          AND company_id = $2
        `,
        [
          projectId,
          client.company_id,
        ]
      );

      const stats = statsRows[0];

      /*
      |--------------------------------------------------------------------------
      | Progress percentage
      |--------------------------------------------------------------------------
      */

      let progress = 0;

      if (Number(stats.total_tasks) > 0) {
        progress = Math.round(
          (Number(stats.completed_tasks) /
            Number(stats.total_tasks)) *
            100
        );
      }

      /*
      |--------------------------------------------------------------------------
      | Tasks
      |--------------------------------------------------------------------------
      */

      const { rows: tasks } = await pool.query(
        `
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.due_date,
          t.created_at,
          t.updated_at

        FROM tasks t

        WHERE t.project_id = $1
          AND t.company_id = $2

        ORDER BY
          CASE
            WHEN LOWER(t.status) IN ('in_progress', 'in progress')
              THEN 1
            WHEN LOWER(t.status) IN ('todo', 'pending')
              THEN 2
            WHEN LOWER(t.status) IN ('completed', 'done')
              THEN 3
            ELSE 4
          END,
          t.due_date ASC NULLS LAST,
          t.created_at DESC
        `,
        [
          projectId,
          client.company_id,
        ]
      );

      return res.json({
        success: true,

        project: projectRows[0],

        progress: {
          percentage: progress,
          total_tasks: Number(stats.total_tasks),
          completed_tasks: Number(stats.completed_tasks),
          in_progress_tasks: Number(stats.in_progress_tasks),
          pending_tasks: Number(stats.pending_tasks),
          overdue_tasks: Number(stats.overdue_tasks),
        },

        tasks,
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET /api/client/projects/:projectId/tasks
|--------------------------------------------------------------------------
| Get tasks of a specific client project
|--------------------------------------------------------------------------
*/

router.get(
  '/projects/:projectId/tasks',
  async (req, res, next) => {
    try {
      const { projectId } = req.params;

      const client = await getClient(req.user.id);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | First verify that project belongs to this client
      |--------------------------------------------------------------------------
      */

      const { rows: projectRows } = await pool.query(
        `
        SELECT
          id,
          name,
          status

        FROM projects

        WHERE id = $1
          AND client_id = $2
          AND company_id = $3
        `,
        [
          projectId,
          client.id,
          client.company_id,
        ]
      );

      if (!projectRows[0]) {
        return res.status(404).json({
          success: false,
          message: 'Project not found',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Get tasks
      |--------------------------------------------------------------------------
      */

      const { rows: tasks } = await pool.query(
        `
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.due_date,
          t.created_at,
          t.updated_at

        FROM tasks t

        WHERE t.project_id = $1
          AND t.company_id = $2

        ORDER BY
          t.due_date ASC NULLS LAST,
          t.created_at DESC
        `,
        [
          projectId,
          client.company_id,
        ]
      );

      return res.json({
        success: true,

        project: projectRows[0],

        tasks,
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
|--------------------------------------------------------------------------
| GET /api/client/meetings
|--------------------------------------------------------------------------
| Get all meetings assigned to logged-in client
|--------------------------------------------------------------------------
*/

router.get('/meetings', async (req, res, next) => {
  try {
    const client = await getClient(req.user.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client profile not found',
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.title,
        m.description,
        m.scheduled_at,
        m.meeting_link,
        m.status,
        m.created_at,

        m.project_id,
        p.name AS project_name

      FROM meetings m

      LEFT JOIN projects p
        ON p.id = m.project_id

      WHERE m.client_id = $1
        AND m.company_id = $2

      ORDER BY m.scheduled_at ASC
      `,
      [
        client.id,
        client.company_id,
      ]
    );

    return res.json({
      success: true,
      meetings: rows,
    });
  } catch (error) {
    next(error);
  }
});

/*
|--------------------------------------------------------------------------
| GET /api/client/meetings/:meetingId
|--------------------------------------------------------------------------
| Get one meeting
|
| IMPORTANT:
| meeting must belong to logged-in client.
|--------------------------------------------------------------------------
*/

router.get(
  '/meetings/:meetingId',
  async (req, res, next) => {
    try {
      const { meetingId } = req.params;

      const client = await getClient(req.user.id);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      const { rows } = await pool.query(
        `
        SELECT
          m.id,
          m.title,
          m.description,
          m.scheduled_at,
          m.meeting_link,
          m.status,
          m.created_at,

          m.project_id,
          p.name AS project_name

        FROM meetings m

        LEFT JOIN projects p
          ON p.id = m.project_id

        WHERE m.id = $1
          AND m.client_id = $2
          AND m.company_id = $3
        `,
        [
          meetingId,
          client.id,
          client.company_id,
        ]
      );

      if (!rows[0]) {
        return res.status(404).json({
          success: false,
          message: 'Meeting not found',
        });
      }

      return res.json({
        success: true,
        meeting: rows[0],
      });
    } catch (error) {
      next(error);
    }
  }
);

/*
|--------------------------------------------------------------------------
| Export
|--------------------------------------------------------------------------
*/

module.exports = router;