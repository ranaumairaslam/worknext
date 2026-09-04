const fs = require('fs');
const path = require('path');
const pool = require('../../config/db');
const {
  uploadBufferToCloudinary,
  isCloudinaryConfigured,
} = require('../../config/cloudinary');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'submissions');

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function sanitizeFileName(originalName) {
  const base = path
    .basename(String(originalName || 'file'))
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  return base.slice(0, 180) || 'file';
}

function buildPublicUrl(req, relativePath) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req.protocol}://${req.get('host')}`;
  return `${String(base).replace(/\/$/, '')}/${relativePath.replace(/^\//, '')}`;
}

async function storeSubmissionFile(req, file) {
  const originalName = file.originalname || 'file';
  const mime = String(file.mimetype || '').toLowerCase();
  const isImage = mime.startsWith('image/');

  if (isCloudinaryConfigured()) {
    try {
      const uploaded = await uploadBufferToCloudinary(file.buffer, {
        folder: 'worknest/member-submissions',
        resource_type: isImage ? 'image' : 'auto',
        overwrite: false,
      });

      return {
        fileUrl: uploaded.secure_url,
        filePublicId: uploaded.public_id || null,
        storage: 'cloudinary',
      };
    } catch (error) {
      console.warn('Cloudinary upload failed, falling back to local storage:', error.message);
    }
  }

  ensureUploadsDir();
  const safeName = sanitizeFileName(originalName);
  const storedName = `${Date.now()}-${safeName}`;
  const absolutePath = path.join(UPLOADS_DIR, storedName);
  fs.writeFileSync(absolutePath, file.buffer);

  const relativePath = `uploads/submissions/${storedName}`;
  return {
    fileUrl: buildPublicUrl(req, relativePath),
    filePublicId: null,
    storage: 'local',
    relativePath,
  };
}

async function createSubmission(req, res) {
  try {
    const taskId = Number.parseInt(req.body?.taskId, 10);
    const description = req.body?.description;
    const file = req.file;

    const errors = {};

    if (!Number.isInteger(taskId) || taskId <= 0) {
      errors.taskId = "Valid Task ID is required";
    }

    if (!file) {
      errors.file = "File is required (image, PDF, or office document)";
    }

    if (!description || !String(description).trim()) {
      errors.description = "Description is required";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({
        success: false,
        code: 400,
        message: "Validation failed",
        errors,
      });
    }

    const userId = req.user.id;
    const companyId =
      req.user.companyId || req.user.company_id || null;

    // ============================================
    // 1. CHECK TASK
    // ============================================
    const taskCheck = await pool.query(
      `
      SELECT
        id,
        assignee_id,
        status
      FROM tasks
      WHERE id = $1
      `,
      [taskId]
    );

    const task = taskCheck.rows[0];

    if (!task) {
      return res.status(404).json({
        success: false,
        code: 404,
        message: "Task not found",
      });
    }

    // ============================================
    // 2. CHECK TASK OWNERSHIP
    // ============================================
    if (task.assignee_id !== userId) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: "You are not assigned to this task",
      });
    }

    // ============================================
    // 3. STORE FILE
    // ============================================
    const stored = await storeSubmissionFile(req, file);

    // ============================================
    // 4. SAVE SUBMISSION
    // ============================================
    const { rows } = await pool.query(
      `
      INSERT INTO member_submissions (
        user_id,
        company_id,
        description,
        file_name,
        file_url,
        file_public_id,
        file_mime_type,
        file_size,
        storage,
        task_id
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10
      )
      RETURNING
        id,
        user_id AS "userId",
        company_id AS "companyId",
        description,
        file_name AS "fileName",
        file_url AS "fileUrl",
        file_public_id AS "filePublicId",
        file_mime_type AS "fileMimeType",
        file_size AS "fileSize",
        storage,
        task_id AS "taskId",
        created_at AS "createdAt"
      `,
      [
        userId,
        companyId,
        String(description).trim(),
        file.originalname || "file",
        stored.fileUrl,
        stored.filePublicId,
        file.mimetype || null,
        file.size || null,
        stored.storage,
        taskId,
      ]
    );

    // ============================================
    // 5. UPDATE TASK STATUS
    // ============================================
    const taskUpdate = await pool.query(
      `
      UPDATE tasks
      SET
        status = 'under_review',
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id AS "taskId",
        status,
        updated_at AS "updatedAt"
      `,
      [taskId]
    );

    // ============================================
    // 6. SUCCESS
    // ============================================
    return res.status(201).json({
      success: true,
      code: 201,
      message: "Task submitted successfully",
      data: {
        submission: rows[0],
        task: taskUpdate.rows[0],
      },
    });
  } catch (error) {
    console.error("createSubmission error:", error);

    return res.status(500).json({
      success: false,
      code: 500,
      message: error.message || "Failed to create submission",
    });
  }
}

module.exports = {
  createSubmission,
};
