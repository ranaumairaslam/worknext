// src/modules/team-leader/TeamLeader.controller.js

const pool = require("../../config/db");

exports.getDashboard = async (req, res, next) => {
  try {
    const companyId = req.user.company_id;
    const leaderId = req.user.id;

    const stats = await pool.query(
      `
      SELECT

      (
        SELECT COUNT(*)
        FROM users
        WHERE company_id = $1
        AND role='employee'
      )::int AS total_members,

      (
        SELECT COUNT(*)
        FROM tasks
        WHERE company_id = $1
        AND assigned_by = $2
      )::int AS total_tasks,

      (
        SELECT COUNT(*)
        FROM tasks
        WHERE company_id = $1
        AND assigned_by = $2
        AND status='pending'
      )::int AS pending_tasks,

      (
        SELECT COUNT(*)
        FROM tasks
        WHERE company_id = $1
        AND assigned_by = $2
        AND status='completed'
      )::int AS completed_tasks,

      (
        SELECT COUNT(*)
        FROM tasks
        WHERE company_id = $1
        AND assigned_by = $2
        AND status='in_review'
      )::int AS pending_reviews
      `,
      [companyId, leaderId]
    );

    const recentTasks = await pool.query(
      `
      SELECT
        t.id,
        t.title,
        t.priority,
        t.status,
        t.deadline,
        u.name AS assigned_to

      FROM tasks t

      LEFT JOIN users u
      ON u.id=t.assigned_to

      WHERE t.company_id=$1
      AND t.assigned_by=$2

      ORDER BY t.created_at DESC
      LIMIT 10
      `,
      [companyId, leaderId]
    );

    return res.json({
      success: true,
      dashboard: "team_leader",
      data: {
        stats: stats.rows[0],
        recentTasks: recentTasks.rows,
      },
    });
  } catch (error) {
    next(error);
  }
};