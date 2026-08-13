const pool = require('../../config/db');

const DEFAULT_SETTINGS = {
  emailAlerts: true,
  pushNotifications: true,
  taskUpdates: true,
  weeklySummary: true,
  newClientAdded: true,
};

function mapSettingsRow(row) {
  return {
    userId: row.user_id,
    emailAlerts: Boolean(row.email_alerts),
    pushNotifications: Boolean(row.push_notifications),
    taskUpdates: Boolean(row.task_updates),
    weeklySummary: Boolean(row.weekly_summary),
    newClientAdded: Boolean(row.new_client_added),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function toBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return fallback;
}

async function getOrCreateSettings(userId) {
  const existing = await pool.query(
    'SELECT * FROM notification_settings WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  if (existing.rows[0]) {
    return mapSettingsRow(existing.rows[0]);
  }

  const created = await pool.query(
    `INSERT INTO notification_settings (user_id)
     VALUES ($1)
     RETURNING *`,
    [userId]
  );

  return mapSettingsRow(created.rows[0]);
}

async function updateSettings(userId, body = {}) {
  await getOrCreateSettings(userId);

  // Accept WeeklySummery typo from frontend as weeklySummary
  const weeklySummaryInput =
    body.weeklySummary !== undefined ? body.weeklySummary : body.weeklySummery;

  const current = await getOrCreateSettings(userId);

  const emailAlerts = toBool(body.emailAlerts, current.emailAlerts);
  const pushNotifications = toBool(
    body.pushNotifications,
    current.pushNotifications
  );
  const taskUpdates = toBool(body.taskUpdates, current.taskUpdates);
  const weeklySummary = toBool(weeklySummaryInput, current.weeklySummary);
  const newClientAdded = toBool(body.newClientAdded, current.newClientAdded);

  const result = await pool.query(
    `UPDATE notification_settings
     SET email_alerts = $2,
         push_notifications = $3,
         task_updates = $4,
         weekly_summary = $5,
         new_client_added = $6,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [
      userId,
      emailAlerts,
      pushNotifications,
      taskUpdates,
      weeklySummary,
      newClientAdded,
    ]
  );

  return mapSettingsRow(result.rows[0]);
}

module.exports = {
  DEFAULT_SETTINGS,
  getOrCreateSettings,
  updateSettings,
};
