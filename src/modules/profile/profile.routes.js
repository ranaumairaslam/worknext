const express = require('express');
const multer = require('multer');
const protect = require('../../middleware/auth.middleware');
const pool = require('../../config/db');
const {
  uploadBufferToCloudinary,
  destroyCloudinaryImage,
  isCloudinaryConfigured,
} = require('../../config/cloudinary');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter(req, file, cb) {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

function formatRoleLabel(role) {
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'company':
      return 'Company';
    case 'team_leader':
      return 'Team Leader';
    case 'team_member':
      return 'Team Member';
    case 'client':
      return 'Client';
    default:
      return role || null;
  }
}

function mapProfile(user) {
  return {
    id: user.id,
    fullName: user.name || null,
    name: user.name || null,
    email: user.email,
    role: user.role || null,
    roleLabel: formatRoleLabel(user.role),
    phone: user.phone || null,
    companyId: user.company_id || null,
    avatarUrl: user.avatar_url || null,
  };
}

/**
 * PUT|PATCH /api/profile
 * Update current user. Only fullName can be edited.
 */
async function updateProfileHandler(req, res) {
  try {
    const fullName = req.body?.fullName ?? req.body?.name;

    if (fullName == null || String(fullName).trim() === '') {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'fullName is required',
      });
    }

    const trimmed = String(fullName).trim();
    if (trimmed.length < 2 || trimmed.length > 255) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'fullName must be between 2 and 255 characters',
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET name = $1
       WHERE id = $2
       RETURNING id, name, email, role, phone, company_id, avatar_url, avatar_public_id`,
      [trimmed, req.user.id]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Profile updated successfully',
      data: mapProfile(user),
    });
  } catch (error) {
    console.error('UPDATE PROFILE ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

/**
 * GET /api/profile
 * Returns current user profile including fullName. avatarUrl is null by default.
 */
async function getProfileHandler(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, phone, company_id, avatar_url, avatar_public_id
       FROM users WHERE id = $1`,
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

    return res.status(200).json({
      success: true,
      code: 200,
      data: mapProfile(user),
    });
  } catch (error) {
    console.error('GET PROFILE ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Server error',
    });
  }
}

/**
 * POST /api/profile/avatar
 * multipart/form-data field name: "image" (or "avatar" / "file")
 * Uploads to Cloudinary and saves URL in users.avatar_url
 */
async function uploadAvatarHandler(req, res) {
  try {
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({
        success: false,
        code: 503,
        message:
          'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Image file is required (form field: image)',
      });
    }

    const existing = await pool.query(
      'SELECT avatar_public_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const oldPublicId = existing.rows[0]?.avatar_public_id || null;

    const uploaded = await uploadBufferToCloudinary(file.buffer, {
      folder: 'worknest/avatars',
      public_id: `user_${req.user.id}`,
      overwrite: true,
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    const result = await pool.query(
      `UPDATE users
       SET avatar_url = $1,
           avatar_public_id = $2
       WHERE id = $3
       RETURNING id, name, email, role, phone, company_id, avatar_url, avatar_public_id`,
      [uploaded.secure_url, uploaded.public_id, req.user.id]
    );

    // Best-effort cleanup if public_id changed
    if (oldPublicId && oldPublicId !== uploaded.public_id) {
      destroyCloudinaryImage(oldPublicId).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Profile picture uploaded successfully',
      data: mapProfile(result.rows[0]),
    });
  } catch (error) {
    console.error('UPLOAD AVATAR ERROR:', error);
    if (error.message === 'Only image files are allowed') {
      return res.status(400).json({
        success: false,
        code: 400,
        message: error.message,
      });
    }
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        code: 400,
        message: 'Image must be 5MB or smaller',
      });
    }
    return res.status(500).json({
      success: false,
      code: 500,
      message: error.message || 'Failed to upload image',
    });
  }
}

/**
 * DELETE /api/profile/avatar
 * Removes profile picture (back to no image).
 */
async function deleteAvatarHandler(req, res) {
  try {
    const existing = await pool.query(
      'SELECT avatar_public_id FROM users WHERE id = $1',
      [req.user.id]
    );
    const publicId = existing.rows[0]?.avatar_public_id || null;

    const result = await pool.query(
      `UPDATE users
       SET avatar_url = NULL,
           avatar_public_id = NULL
       WHERE id = $1
       RETURNING id, name, email, role, phone, company_id, avatar_url, avatar_public_id`,
      [req.user.id]
    );

    if (publicId) {
      destroyCloudinaryImage(publicId).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      code: 200,
      message: 'Profile picture removed',
      data: mapProfile(result.rows[0]),
    });
  } catch (error) {
    console.error('DELETE AVATAR ERROR:', error);
    return res.status(500).json({
      success: false,
      code: 500,
      message: 'Failed to remove profile picture',
    });
  }
}

function handleMulter(req, res, next) {
  // Accept any field name (image, avatar, file, picture, photo, etc.)
  upload.any()(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Image must be 5MB or smaller'
          : err.message || 'Upload failed';
      return res.status(400).json({
        success: false,
        code: 400,
        message,
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const imageFile =
      files.find((f) => f.mimetype && f.mimetype.startsWith('image/')) ||
      files[0] ||
      null;

    req.file = imageFile || null;
    next();
  });
}

router.use(protect);

router
  .route('/')
  .get(getProfileHandler)
  .put(updateProfileHandler)
  .patch(updateProfileHandler)
  .all(methodNotAllowed(['GET', 'PUT', 'PATCH']));

router
  .route('/avatar')
  .post(handleMulter, uploadAvatarHandler)
  .delete(deleteAvatarHandler)
  .all(methodNotAllowed(['POST', 'DELETE']));

module.exports = router;
