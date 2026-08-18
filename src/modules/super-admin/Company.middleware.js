const path = require('path');
const multer = require('multer');

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
]);

function isImageFile(file) {
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;

  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return true;

  return false;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!isImageFile(file)) {
      return cb(new Error('Payment receipt must be an image file'));
    }
    cb(null, true);
  },
});

const RECEIPT_FIELD_NAMES = new Set([
  'paymentreceipt',
  'paymentreciept',
  'payment_receipt',
]);

function isReceiptField(fieldName) {
  if (!fieldName) return false;
  return RECEIPT_FIELD_NAMES.has(String(fieldName).toLowerCase());
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return undefined;
}

function normalizeUpdateCompanyFields(req, res, next) {
  const body = req.body || {};

  req.body = {
    name: pickFirst(
      body.CompanyName,
      body.companyName,
      body.name
    ),
    status: pickFirst(
      body.CompanyStatus,
      body.companyStatus,
      body.status
    ),
    industry: pickFirst(body.Industry, body.industry),
    address: pickFirst(
      body.Address,
      body.address,
      body.Location,
      body.location
    ),
  };

  next();
}

function normalizeCreateCompanyFields(req, res, next) {
  const body = req.body || {};

  req.body = {
    name: pickFirst(
      body.CompanyName,
      body.companyName,
      body.name
    ),
    industry: pickFirst(body.Industry, body.industry),
    account_owner: pickFirst(
      body.AccountOwner,
      body.accountOwner,
      body.account_owner
    ),
    email: pickFirst(
      body.CompanyLoginEmail,
      body.companyLoginEmail,
      body.email
    ),
    password: pickFirst(
      body.CompanyLoginPassword,
      body.CompanyLoinPassword,
      body.companyLoginPassword,
      body.companyLoinPassword,
      body.password
    ),
    company_size: pickFirst(
      body.CompanySize,
      body.companySize,
      body.company_size
    ),
    platform_fee: pickFirst(
      body.Payment,
      body.payment,
      body.platform_fee,
      body.platformFee
    ),
    location: pickFirst(body.Location, body.location),
    status: pickFirst(
      body.CompanyStatus,
      body.companyStatus,
      body.status
    ),
    payment_status: pickFirst(
      body.PaymentStatus,
      body.paymentStatus,
      body.payment_status
    ),
  };

  next();
}

function handleCreateCompanyUpload(req, res, next) {
  upload.any()(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Payment receipt image must be 5MB or smaller'
          : err.message || 'Upload failed';

      return res.status(400).json({
        success: false,
        message,
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const receiptFile =
      files.find((file) => isReceiptField(file.fieldname) && isImageFile(file)) ||
      files.find((file) => isImageFile(file)) ||
      null;

    req.file = receiptFile || null;
    next();
  });
}

module.exports = {
  handleCreateCompanyUpload,
  normalizeCreateCompanyFields,
  normalizeUpdateCompanyFields,
};
