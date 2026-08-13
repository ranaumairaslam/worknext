const express = require('express');
const protect = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const {
  createNotification,
  getNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} = require('./notification.service');
const {
  getOrCreateSettings,
  updateSettings,
} = require('./notification-settings.service');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

async function loadCurrentUser(req, res, next) {
  try {
    const result = await pool.query(
      'SELECT id, email, role, company_id, name FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'User not found',
      });
    }
    req.currentUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

router.use(protect, loadCurrentUser);

/**
 * GET /api/notifications/settings
 * PUT|PATCH /api/notifications/settings
 * Switches: emailAlerts, pushNotifications, taskUpdates, weeklySummary, newClientAdded
 */
async function getSettingsHandler(req, res) {
  try {
    const settings = await getOrCreateSettings(req.currentUser.id);
    return res.status(200).json({
      success: true,
      code: 200,
      data: settings,
    });
  } catch (error) {
    console.error('GET NOTIFICATION SETTINGS ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Failed to load notification settings',
    });
  }
}

async function updateSettingsHandler(req, res) {
  try {
    const settings = await updateSettings(req.currentUser.id, req.body || {});
    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Notification settings updated',
      data: settings,
    });
  } catch (error) {
    console.error('UPDATE NOTIFICATION SETTINGS ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Failed to update notification settings',
    });
  }
}

router
  .route('/settings')
  .get(getSettingsHandler)
  .put(updateSettingsHandler)
  .patch(updateSettingsHandler)
  .all(methodNotAllowed(['GET', 'PUT', 'PATCH']));

/**
 * GET /api/notifications
 * List in-app notifications for the logged-in user (CareClinic-style).
 */
async function listNotificationsHandler(req, res) {
  try {
    const notifications = await getNotificationsForUser({
      userId: req.currentUser.id,
      email: req.currentUser.email,
      companyId: req.currentUser.company_id || null,
    });
    const unreadCount = notifications.filter((n) => !n.read).length;

    return res.status(200).json({
      success: true,
      code: 200,
      notifications,
      unreadCount,
    });
  } catch (error) {
    console.error('LIST NOTIFICATIONS ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Failed to load notifications',
    });
  }
}

/**
 * PATCH /api/notifications
 * Body: { notificationId } OR { markAll: true }
 */
async function updateNotificationsHandler(req, res) {
  try {
    const { notificationId, markAll } = req.body || {};

    if (markAll) {
      const notifications = await markAllNotificationsRead({
        userId: req.currentUser.id,
        email: req.currentUser.email,
      });
      return res.status(200).json({
        success: true,
        code: 200,
        notifications,
        unreadCount: 0,
      });
    }

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'notificationId is required (or set markAll: true)',
      });
    }

    const updated = await markNotificationRead(notificationId, {
      userId: req.currentUser.id,
      email: req.currentUser.email,
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'Notification not found',
      });
    }

    const notifications = await getNotificationsForUser({
      userId: req.currentUser.id,
      email: req.currentUser.email,
    });
    const unreadCount = await getUnreadCount({
      userId: req.currentUser.id,
      email: req.currentUser.email,
    });

    return res.status(200).json({
      success: true,
      code: 200,
      notifications,
      unreadCount,
      data: updated,
    });
  } catch (error) {
    console.error('UPDATE NOTIFICATIONS ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Failed to update notifications',
    });
  }
}

/**
 * POST /api/notifications
 * Create a notification (company / super_admin / team_leader).
 * Body: { recipientUserId? , recipientEmail?, type, title, message?, link?, metadata? }
 */
async function createNotificationHandler(req, res) {
  try {
    const role = req.currentUser.role;
    if (!['company', 'super_admin', 'team_leader'].includes(role)) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: 'You do not have permission to create notifications',
      });
    }

    const {
      recipientUserId,
      recipientEmail,
      type,
      title,
      message,
      link,
      metadata,
    } = req.body || {};

    if (!type || !title) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'type and title are required',
      });
    }

    if (!recipientUserId && !recipientEmail) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'recipientUserId or recipientEmail is required',
      });
    }

    const notification = await createNotification({
      companyId: req.currentUser.company_id || null,
      userId: recipientUserId || null,
      recipientEmail: recipientEmail || null,
      type,
      title,
      message: message || title,
      link: link || null,
      metadata: metadata || {},
    });

    return res.status(201).json({
      success: true,
      code: 201,
      notification,
    });
  } catch (error) {
    console.error('CREATE NOTIFICATION ERROR:', error);
    const status = error.status || 500;
    return res.status(status).json({
      success: false,
      code: status,
      message: error.message || 'Failed to create notification',
    });
  }
}

router
  .route('/')
  .get(listNotificationsHandler)
  .post(createNotificationHandler)
  .patch(updateNotificationsHandler)
  .all(methodNotAllowed(['GET', 'POST', 'PATCH']));

module.exports = router;
module.exports.createNotification = createNotification;
