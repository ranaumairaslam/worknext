const pool = require('../../config/db');

function mapNotificationRow(row) {
  const metadata =
    row.metadata && typeof row.metadata === 'object' ? row.metadata : {};

  return {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    type: row.type,
    title: row.title,
    message: row.message || '',
    link: row.link || null,
    recipientEmail: row.recipient_email,
    read: Boolean(row.read),
    createdAt: row.created_at,
    ...metadata,
  };
}

async function resolveRecipientUserId({ userId, recipientEmail }) {
  if (userId) return userId;
  if (!recipientEmail) return null;

  const result = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [String(recipientEmail).trim().toLowerCase()]
  );
  return result.rows[0]?.id || null;
}

/**
 * Create an in-app notification (CareClinic-style).
 * Prefer userId; recipientEmail is also stored for filtering.
 */
async function createNotification(payload) {
  const {
    companyId = null,
    userId = null,
    recipientEmail = null,
    type,
    title,
    message = '',
    link = null,
    read = false,
    metadata = {},
  } = payload;

  if (!type || !title) {
    throw Object.assign(new Error('type and title are required'), { status: 400 });
  }

  const email = recipientEmail
    ? String(recipientEmail).trim().toLowerCase()
    : null;
  const resolvedUserId = await resolveRecipientUserId({ userId, recipientEmail: email });

  const result = await pool.query(
    `INSERT INTO notifications
       (company_id, user_id, recipient_email, type, title, message, link, read, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [
      companyId,
      resolvedUserId,
      email,
      type,
      title,
      message || '',
      link,
      Boolean(read),
      JSON.stringify(metadata || {}),
    ]
  );

  return mapNotificationRow(result.rows[0]);
}

async function getNotificationsForUser({ userId, email, companyId = null }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const params = [userId, normalizedEmail];
  let companyFilter = '';

  if (companyId != null) {
    params.push(companyId);
    companyFilter = ` AND (company_id IS NULL OR company_id = $${params.length})`;
  }

  const result = await pool.query(
    `SELECT * FROM notifications
     WHERE (
       user_id = $1
       OR ($2::text IS NOT NULL AND LOWER(recipient_email) = $2)
     )
     ${companyFilter}
     ORDER BY created_at DESC`,
    params
  );

  return result.rows.map(mapNotificationRow);
}

async function getUnreadCount({ userId, email }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM notifications
     WHERE read = FALSE
       AND (
         user_id = $1
         OR ($2::text IS NOT NULL AND LOWER(recipient_email) = $2)
       )`,
    [userId, normalizedEmail]
  );
  return result.rows[0]?.count || 0;
}

async function markNotificationRead(notificationId, { userId, email }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  const result = await pool.query(
    `UPDATE notifications
     SET read = TRUE
     WHERE id = $1
       AND (
         user_id = $2
         OR ($3::text IS NOT NULL AND LOWER(recipient_email) = $3)
       )
     RETURNING *`,
    [notificationId, userId, normalizedEmail]
  );

  return result.rows[0] ? mapNotificationRow(result.rows[0]) : null;
}

async function markAllNotificationsRead({ userId, email }) {
  const normalizedEmail = email ? String(email).trim().toLowerCase() : null;
  await pool.query(
    `UPDATE notifications
     SET read = TRUE
     WHERE read = FALSE
       AND (
         user_id = $1
         OR ($2::text IS NOT NULL AND LOWER(recipient_email) = $2)
       )`,
    [userId, normalizedEmail]
  );

  return getNotificationsForUser({ userId, email: normalizedEmail });
}

module.exports = {
  mapNotificationRow,
  createNotification,
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
};
