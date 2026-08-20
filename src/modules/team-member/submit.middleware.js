const path = require('path');
const multer = require('multer');

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);

const OFFICE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
]);

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/octet-stream',
]);

const FILE_FIELD_NAMES = new Set([
  'file',
  'File',
  'attachment',
  'document',
  'upload',
]);

function getExtension(file) {
  return path.extname(file?.originalname || '').toLowerCase();
}

function isAllowedFile(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = getExtension(file);

  if (IMAGE_EXTENSIONS.has(ext) || PDF_EXTENSIONS.has(ext) || OFFICE_EXTENSIONS.has(ext)) {
    return true;
  }

  if (mime.startsWith('image/')) return true;
  if (ALLOWED_MIME_TYPES.has(mime)) return true;

  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!isAllowedFile(file)) {
      return cb(
        new Error(
          'Only image, PDF, or office files are allowed (.jpg, .png, .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx)'
        )
      );
    }
    cb(null, true);
  },
});

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function handleSubmitUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File must be 15MB or smaller'
          : err.message || 'Upload failed';

      return res.status(400).json({
        success: false,
        code: 400,
        message,
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const uploadedFile =
      files.find((file) => FILE_FIELD_NAMES.has(file.fieldname) && isAllowedFile(file)) ||
      files.find((file) => isAllowedFile(file)) ||
      null;

    req.file = uploadedFile;

    const body = req.body || {};
    req.body = {
      ...body,
      description: pickFirst(
        body.Description,
        body.description,
        body.Note,
        body.note
      ),
    };

    return next();
  });
}

module.exports = {
  handleSubmitUpload,
  isAllowedFile,
};
