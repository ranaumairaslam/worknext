const express = require('express');
const pool = require('../../config/db');
const protect = require('../../middleware/auth.middleware');

const router = express.Router();

console.log('✅ Client User Routes Loaded');

/*
|--------------------------------------------------------------------------
| GET CLIENT PROFILE
|--------------------------------------------------------------------------
*/

async function getClient(req) {
  const query = `
    SELECT
      cl.id,
      cl.name,
      cl.email,
      cl.company_id,
      cl.created_at,
      c.name AS company_name
    FROM clients cl
    JOIN companies c
      ON c.id = cl.company_id
    WHERE cl.user_id = $1
    LIMIT 1
  `;

  const { rows } = await pool.query(query, [req.user.id]);

  return rows[0] || null;
}


/*
|--------------------------------------------------------------------------
| 1. CLIENT DASHBOARD
|--------------------------------------------------------------------------
| GET /api/client/dashboard
|--------------------------------------------------------------------------
*/

router.get(
  '/dashboard',
  protect,
  async (req, res, next) => {
    try {
      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Projects
      |--------------------------------------------------------------------------
      */

      const projectsQuery = `
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
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN ('completed', 'done')
              THEN 1
            END
          )::int AS completed_tasks,

          CASE
            WHEN COUNT(t.id) = 0 THEN 0
            ELSE ROUND(
              (
                COUNT(
                  CASE
                    WHEN LOWER(COALESCE(t.status, '')) IN ('completed', 'done')
                    THEN 1
                  END
                ) * 100.0
              ) / COUNT(t.id)
            )
          END AS progress

        FROM projects p

        LEFT JOIN tasks t
          ON t.project_id = p.id

        WHERE p.client_id = $1

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

      const { rows: projects } = await pool.query(projectsQuery, [
        client.id,
      ]);


      /*
      |--------------------------------------------------------------------------
      | Total Tasks
      |--------------------------------------------------------------------------
      */

      const tasksCountQuery = `
        SELECT COUNT(t.id)::int AS total_tasks
        FROM tasks t
        JOIN projects p
          ON p.id = t.project_id
        WHERE p.client_id = $1
      `;

      const { rows: taskCountRows } = await pool.query(
        tasksCountQuery,
        [client.id]
      );

      const totalTasks = taskCountRows[0]?.total_tasks || 0;


      /*
      |--------------------------------------------------------------------------
      | Completed Tasks
      |--------------------------------------------------------------------------
      */

      const completedTasksQuery = `
        SELECT COUNT(t.id)::int AS completed_tasks
        FROM tasks t
        JOIN projects p
          ON p.id = t.project_id
        WHERE p.client_id = $1
          AND LOWER(COALESCE(t.status, '')) IN ('completed', 'done')
      `;

      const { rows: completedTaskRows } = await pool.query(
        completedTasksQuery,
        [client.id]
      );

      const completedTasks =
        completedTaskRows[0]?.completed_tasks || 0;


      /*
      |--------------------------------------------------------------------------
      | Overall Progress
      |--------------------------------------------------------------------------
      */

      const overallProgress =
        totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : 0;


      /*
      |--------------------------------------------------------------------------
      | Meetings Count
      |--------------------------------------------------------------------------
      */

      const meetingsCountQuery = `
        SELECT COUNT(m.id)::int AS total_meetings
        FROM meetings m
        WHERE m.client_id = $1
          AND m.company_id = $2
      `;

      const { rows: meetingCountRows } = await pool.query(
        meetingsCountQuery,
        [client.id, client.company_id]
      );

      const totalMeetings =
        meetingCountRows[0]?.total_meetings || 0;


      /*
      |--------------------------------------------------------------------------
      | Upcoming Meetings
      |--------------------------------------------------------------------------
      */

      const upcomingMeetingsQuery = `
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
        JOIN companies c
          ON c.id = m.company_id
        WHERE m.client_id = $1
          AND m.company_id = $2
          AND m.scheduled_at >= NOW()
        ORDER BY m.scheduled_at ASC
        LIMIT 5
      `;

      const { rows: upcomingMeetings } = await pool.query(
        upcomingMeetingsQuery,
        [client.id, client.company_id]
      );


      /*
      |--------------------------------------------------------------------------
      | Dashboard Response
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
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

          statistics: {
            projects: projects.length,
            progress: overallProgress,
            meetings: totalMeetings,
            tasks: totalTasks,
            completed_tasks: completedTasks,
          },

          projects,

          upcoming_meetings: upcomingMeetings,
        },
      });
    } catch (error) {
      console.error('❌ Client dashboard error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 2. GET ALL CLIENT PROJECTS
|--------------------------------------------------------------------------
| GET /api/client/projects
|--------------------------------------------------------------------------
*/

router.get(
  '/projects',
  protect,
  async (req, res, next) => {
    try {
      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

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
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN ('completed', 'done')
              THEN 1
            END
          )::int AS completed_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('in progress', 'in_progress')
              THEN 1
            END
          )::int AS in_progress_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN ('pending', 'todo')
              THEN 1
            END
          )::int AS pending_tasks,

          CASE
            WHEN COUNT(t.id) = 0 THEN 0
            ELSE ROUND(
              (
                COUNT(
                  CASE
                    WHEN LOWER(COALESCE(t.status, '')) IN
                      ('completed', 'done')
                    THEN 1
                  END
                ) * 100.0
              ) / COUNT(t.id)
            )
          END AS progress

        FROM projects p

        LEFT JOIN tasks t
          ON t.project_id = p.id

        WHERE p.client_id = $1

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

      const { rows: projects } = await pool.query(query, [
        client.id,
      ]);

      return res.status(200).json({
        success: true,
        count: projects.length,
        projects,
      });
    } catch (error) {
      console.error('❌ Get client projects error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 3. GET SINGLE PROJECT DETAIL
|--------------------------------------------------------------------------
| GET /api/client/projects/:projectId
|--------------------------------------------------------------------------
*/

router.get(
  '/projects/:projectId',
  protect,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;

      const client = await getClient(req);

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

      const projectQuery = `
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
        LIMIT 1
      `;

      const { rows: projectRows } = await pool.query(
        projectQuery,
        [projectId, client.id]
      );

      if (projectRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Project not found or access denied',
        });
      }

      const project = projectRows[0];


      /*
      |--------------------------------------------------------------------------
      | Tasks
      |--------------------------------------------------------------------------
      */

      const tasksQuery = `
        SELECT
          t.id,
          t.title,
          t.description,
          t.status,
          t.priority,
          t.due_date,
          t.created_at
        FROM tasks t
        WHERE t.project_id = $1
        ORDER BY
          t.due_date ASC NULLS LAST,
          t.created_at DESC
      `;

      const { rows: tasks } = await pool.query(
        tasksQuery,
        [projectId]
      );


      /*
      |--------------------------------------------------------------------------
      | Task Statistics
      |--------------------------------------------------------------------------
      */

      const statisticsQuery = `
        SELECT

          COUNT(t.id)::int AS total_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN ('completed', 'done')
              THEN 1
            END
          )::int AS completed_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('in progress', 'in_progress')
              THEN 1
            END
          )::int AS in_progress_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('pending', 'todo')
              THEN 1
            END
          )::int AS pending_tasks

        FROM tasks t
        WHERE t.project_id = $1
      `;

      const { rows: statisticsRows } = await pool.query(
        statisticsQuery,
        [projectId]
      );

      const statistics = statisticsRows[0];


      const totalTasks = Number(statistics.total_tasks) || 0;
      const completedTasks =
        Number(statistics.completed_tasks) || 0;

      const progress =
        totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : 0;


      /*
      |--------------------------------------------------------------------------
      | Project Meetings
      |--------------------------------------------------------------------------
      */

      const meetingsQuery = `
        SELECT
          m.id,
          m.title,
          m.description,
          m.scheduled_at,
          m.meeting_link,
          m.status,
          m.created_at
        FROM meetings m
        WHERE m.client_id = $1
          AND m.company_id = $2
        ORDER BY m.scheduled_at ASC
      `;

      const { rows: meetings } = await pool.query(
        meetingsQuery,
        [client.id, client.company_id]
      );


      /*
      |--------------------------------------------------------------------------
      | Response
      |--------------------------------------------------------------------------
      */

      return res.status(200).json({
        success: true,

        project: {
          ...project,

          total_tasks: totalTasks,
          completed_tasks: completedTasks,
          in_progress_tasks:
            Number(statistics.in_progress_tasks) || 0,
          pending_tasks:
            Number(statistics.pending_tasks) || 0,

          progress,
        },

        tasks,

        meetings,
      });
    } catch (error) {
      console.error('❌ Client project detail error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 4. GET ALL CLIENT MEETINGS
|--------------------------------------------------------------------------
| GET /api/client/meetings
|--------------------------------------------------------------------------
*/

router.get(
  '/meetings',
  protect,
  async (req, res, next) => {
    try {
      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      const query = `
        SELECT
          m.id,
          m.title,
          m.description,
          m.scheduled_at,
          m.meeting_link,
          m.status,
          m.created_at,

          c.id AS company_id,
          c.name AS company_name

        FROM meetings m

        JOIN companies c
          ON c.id = m.company_id

        WHERE m.client_id = $1
          AND m.company_id = $2

        ORDER BY m.scheduled_at ASC
      `;

      const { rows: meetings } = await pool.query(query, [
        client.id,
        client.company_id,
      ]);

      return res.status(200).json({
        success: true,
        count: meetings.length,
        meetings,
      });
    } catch (error) {
      console.error('❌ Get client meetings error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 5. GET SINGLE MEETING
|--------------------------------------------------------------------------
| GET /api/client/meetings/:meetingId
|--------------------------------------------------------------------------
*/

router.get(
  '/meetings/:meetingId',
  protect,
  async (req, res, next) => {
    try {
      const { meetingId } = req.params;

      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }

      const query = `
        SELECT
          m.id,
          m.title,
          m.description,
          m.scheduled_at,
          m.meeting_link,
          m.status,
          m.created_at,

          c.id AS company_id,
          c.name AS company_name

        FROM meetings m

        JOIN companies c
          ON c.id = m.company_id

        WHERE m.id = $1
          AND m.client_id = $2
          AND m.company_id = $3

        LIMIT 1
      `;

      const { rows } = await pool.query(query, [
        meetingId,
        client.id,
        client.company_id,
      ]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Meeting not found or access denied',
        });
      }

      return res.status(200).json({
        success: true,
        meeting: rows[0],
      });
    } catch (error) {
      console.error('❌ Get single meeting error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 6. CREATE MEETING
|--------------------------------------------------------------------------
| POST /api/client/meetings
|--------------------------------------------------------------------------
| This allows logged-in client to schedule a meeting.
|
| If ONLY Company Admin should create meetings,
| keep this API in the Company Admin routes instead.
|--------------------------------------------------------------------------
*/

router.post(
  '/meetings',
  protect,
  async (req, res, next) => {
    try {
      const {
        title,
        description,
        scheduled_at,
        meeting_link,
        status = 'scheduled',
      } = req.body;

      /*
      |--------------------------------------------------------------------------
      | Validation
      |--------------------------------------------------------------------------
      */

      if (!title || !String(title).trim()) {
        return res.status(400).json({
          success: false,
          message: 'Meeting title is required',
        });
      }

      if (!scheduled_at) {
        return res.status(400).json({
          success: false,
          message: 'Meeting date and time are required',
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Get Client
      |--------------------------------------------------------------------------
      */

      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Create Meeting
      |--------------------------------------------------------------------------
      */

      const query = `
        INSERT INTO meetings (
          title,
          description,
          scheduled_at,
          meeting_link,
          status,
          client_id,
          company_id,
          created_at
        )

        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          NOW()
        )

        RETURNING
          id,
          title,
          description,
          scheduled_at,
          meeting_link,
          status,
          client_id,
          company_id,
          created_at
      `;

      const { rows } = await pool.query(query, [
        String(title).trim(),
        description || null,
        scheduled_at,
        meeting_link || null,
        status,
        client.id,
        client.company_id,
      ]);

      return res.status(201).json({
        success: true,
        message: 'Meeting created successfully',
        meeting: rows[0],
      });
    } catch (error) {
      console.error('❌ Create client meeting error:', error);
      next(error);
    }
  }
);


/*
|--------------------------------------------------------------------------
| 7. GET PROJECT PROGRESS
|--------------------------------------------------------------------------
| GET /api/client/projects/:projectId/progress
|--------------------------------------------------------------------------
*/

router.get(
  '/projects/:projectId/progress',
  protect,
  async (req, res, next) => {
    try {
      const { projectId } = req.params;

      const client = await getClient(req);

      if (!client) {
        return res.status(404).json({
          success: false,
          message: 'Client profile not found',
        });
      }


      /*
      |--------------------------------------------------------------------------
      | Project + Progress
      |--------------------------------------------------------------------------
      */

      const projectQuery = `
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
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('completed', 'done')
              THEN 1
            END
          )::int AS completed_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('in progress', 'in_progress')
              THEN 1
            END
          )::int AS in_progress_tasks,

          COUNT(
            CASE
              WHEN LOWER(COALESCE(t.status, '')) IN
                ('pending', 'todo')
              THEN 1
            END
          )::int AS pending_tasks,

          CASE
            WHEN COUNT(t.id) = 0 THEN 0
            ELSE ROUND(
              (
                COUNT(
                  CASE
                    WHEN LOWER(COALESCE(t.status, '')) IN
                      ('completed', 'done')
                    THEN 1
                  END
                ) * 100.0
              ) / COUNT(t.id)
            )
          END AS progress

        FROM projects p

        LEFT JOIN tasks t
          ON t.project_id = p.id

        WHERE p.id = $1
          AND p.client_id = $2

        GROUP BY
          p.id,
          p.name,
          p.description,
          p.status,
          p.start_date,
          p.end_date,
          p.created_at

        LIMIT 1
      `;

      const { rows } = await pool.query(projectQuery, [
        projectId,
        client.id,
      ]);

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Project not found or access denied',
        });
      }

      return res.status(200).json({
        success: true,
        project: rows[0],
      });
    } catch (error) {
      console.error('❌ Client project progress error:', error);
      next(error);
    }
  }
);


module.exports = router;