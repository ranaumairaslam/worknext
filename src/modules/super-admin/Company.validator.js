const validator = require('validator');

/*
|--------------------------------------------------------------------------
| Validate Add Company
|--------------------------------------------------------------------------
*/

const validateCreateCompany = (req, res, next) => {
  const {
    name,
    industry,
    account_owner,
    email,
    password,
    company_size,
    platform_fee,
    location,
    status,
    payment_status,
  } = req.body;

  const errors = {};
  const fieldErrors = {};

  /*
  |--------------------------------------------------------------------------
  | Company Name
  |--------------------------------------------------------------------------
  */

  if (!name || !String(name).trim()) {
    errors.name = 'Company name is required';
    fieldErrors.CompanyName = 'Company name is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Industry
  |--------------------------------------------------------------------------
  */

  if (!industry || !String(industry).trim()) {
    errors.industry = 'Industry is required';
    fieldErrors.Industry = 'Industry is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Account Owner
  |--------------------------------------------------------------------------
  */

  if (!account_owner || !String(account_owner).trim()) {
    errors.account_owner = 'Account owner is required';
    fieldErrors.AccountOwner = 'Account owner is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Email
  |--------------------------------------------------------------------------
  */

  if (!email || !String(email).trim()) {
    errors.email = 'Company login email is required';
    fieldErrors.CompanyLoginEmail = 'Company login email is required';
  } else if (!validator.isEmail(String(email).trim())) {
    errors.email = 'Please provide a valid email address';
    fieldErrors.CompanyLoginEmail = 'Please provide a valid email address';
  }

  /*
  |--------------------------------------------------------------------------
  | Password
  |--------------------------------------------------------------------------
  */

  if (!password) {
    errors.password = 'Company login password is required';
    fieldErrors.CompanyLoginPassword = 'Company login password is required';
  } else if (String(password).length < 6) {
    errors.password = 'Password must be at least 6 characters';
    fieldErrors.CompanyLoginPassword =
      'Password must be at least 6 characters';
  }

  /*
  |--------------------------------------------------------------------------
  | Company Size
  |--------------------------------------------------------------------------
  */

  if (!company_size || !String(company_size).trim()) {
    errors.company_size = 'Company size is required';
    fieldErrors.CompanySize = 'Company size is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Platform Fee
  |--------------------------------------------------------------------------
  */

  if (
    platform_fee === undefined ||
    platform_fee === null ||
    platform_fee === ''
  ) {
    errors.platform_fee = 'Payment amount is required';
    fieldErrors.Payment = 'Payment amount is required';
  } else if (
    Number.isNaN(Number(platform_fee)) ||
    Number(platform_fee) < 0
  ) {
    errors.platform_fee =
      'Payment must be a valid non-negative number';
    fieldErrors.Payment =
      'Payment must be a valid non-negative number';
  }

  /*
  |--------------------------------------------------------------------------
  | Location
  |--------------------------------------------------------------------------
  */

  if (!location || !String(location).trim()) {
    errors.location = 'Location is required';
    fieldErrors.Location = 'Location is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Status
  |--------------------------------------------------------------------------
  */

  if (
    status &&
    !['active', 'inactive', 'pending', 'suspended'].includes(
      String(status).toLowerCase()
    )
  ) {
    errors.status = 'Invalid company status';
    fieldErrors.CompanyStatus = 'Invalid company status';
  }

  /*
  |--------------------------------------------------------------------------
  | Payment Status
  |--------------------------------------------------------------------------
  */

  if (
    payment_status &&
    !['paid', 'pending', 'failed', 'cancelled'].includes(
      String(payment_status).toLowerCase()
    )
  ) {
    errors.payment_status = 'Invalid payment status';
    fieldErrors.PaymentStatus = 'Invalid payment status';
  }

  const normalizedPaymentStatus = payment_status
    ? String(payment_status).toLowerCase()
    : 'pending';

  if (normalizedPaymentStatus === 'paid' && !req.file) {
    errors.payment_receipt =
      'Payment receipt image is required when payment status is paid';
    fieldErrors.PaymentReceipt =
      'Payment receipt image is required when payment status is paid';
  }

  /*
  |--------------------------------------------------------------------------
  | Return Errors
  |--------------------------------------------------------------------------
  */

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors,
      fieldErrors,
    });
  }

  next();
};


/*
|--------------------------------------------------------------------------
| Validate Company Query
|--------------------------------------------------------------------------
*/

const validateCompanyQuery = (req, res, next) => {
  const { status, payment_status } = req.query;

  const validStatuses = [
    'all',
    'active',
    'inactive',
    'pending',
    'suspended',
  ];

  const validPaymentStatuses = [
    'all',
    'paid',
    'pending',
    'failed',
    'cancelled',
  ];

  if (
    status &&
    !validStatuses.includes(String(status).toLowerCase())
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid status filter',
    });
  }

  if (
    payment_status &&
    !validPaymentStatuses.includes(
      String(payment_status).toLowerCase()
    )
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment status filter',
    });
  }

  next();
};


/*
|--------------------------------------------------------------------------
| Validate Update Company
|--------------------------------------------------------------------------
| PUT /api/super-admin/companies/:companyId
| Fields: companyName, status, industry, address
|--------------------------------------------------------------------------
*/

const ALLOWED_COMPANY_STATUSES = [
  'active',
  'inactive',
  'pending',
  'suspended',
  'suspend',
];

const ALLOWED_PAYMENT_STATUSES = [
  'paid',
  'pending',
  'failed',
  'cancelled',
];

function normalizeCompanyStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (value === 'suspend') return 'suspended';
  return value;
}

const validateUpdateCompany = (req, res, next) => {
  const { name, status, industry, address, payment_status } = req.body;
  const errors = {};
  const fieldErrors = {};

  if (!name || !String(name).trim()) {
    errors.name = 'Company name is required';
    fieldErrors.companyName = 'Company name is required';
  }

  if (!status || !String(status).trim()) {
    errors.status = 'Status is required';
    fieldErrors.status = 'Status is required';
  } else if (
    !ALLOWED_COMPANY_STATUSES.includes(String(status).toLowerCase())
  ) {
    errors.status = `Status must be one of: active, inactive, pending, suspended (or suspend)`;
    fieldErrors.status = `Status must be one of: active, inactive, pending, suspended (or suspend)`;
  } else {
    req.body.status = normalizeCompanyStatus(status);
  }

  if (!industry || !String(industry).trim()) {
    errors.industry = 'Industry is required';
    fieldErrors.industry = 'Industry is required';
  }

  if (!address || !String(address).trim()) {
    errors.address = 'Address is required';
    fieldErrors.address = 'Address is required';
  }

  if (
    payment_status &&
    !ALLOWED_PAYMENT_STATUSES.includes(String(payment_status).toLowerCase())
  ) {
    errors.payment_status = `Payment status must be one of: ${ALLOWED_PAYMENT_STATUSES.join(', ')}`;
    fieldErrors.paymentStatus = `Payment status must be one of: ${ALLOWED_PAYMENT_STATUSES.join(', ')}`;
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({
      success: false,
      code: 400,
      message: 'Validation failed',
      errors,
      fieldErrors,
    });
  }

  next();
};


module.exports = {
  validateCreateCompany,
  validateCompanyQuery,
  validateUpdateCompany,
};