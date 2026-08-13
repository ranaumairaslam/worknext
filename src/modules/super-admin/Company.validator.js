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

  /*
  |--------------------------------------------------------------------------
  | Company Name
  |--------------------------------------------------------------------------
  */

  if (!name || !String(name).trim()) {
    errors.name = 'Company name is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Industry
  |--------------------------------------------------------------------------
  */

  if (!industry || !String(industry).trim()) {
    errors.industry = 'Industry is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Account Owner
  |--------------------------------------------------------------------------
  */

  if (!account_owner || !String(account_owner).trim()) {
    errors.account_owner = 'Account owner is required';
  }

  /*
  |--------------------------------------------------------------------------
  | Email
  |--------------------------------------------------------------------------
  */

  if (!email || !String(email).trim()) {
    errors.email = 'Company login email is required';
  } else if (!validator.isEmail(String(email).trim())) {
    errors.email = 'Please provide a valid email address';
  }

  /*
  |--------------------------------------------------------------------------
  | Password
  |--------------------------------------------------------------------------
  */

  if (!password) {
    errors.password = 'Company login password is required';
  } else if (String(password).length < 6) {
    errors.password = 'Password must be at least 6 characters';
  }

  /*
  |--------------------------------------------------------------------------
  | Company Size
  |--------------------------------------------------------------------------
  */

  if (!company_size || !String(company_size).trim()) {
    errors.company_size = 'Company size is required';
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
    errors.platform_fee = 'Platform fee is required';
  } else if (
    Number.isNaN(Number(platform_fee)) ||
    Number(platform_fee) < 0
  ) {
    errors.platform_fee =
      'Platform fee must be a valid non-negative number';
  }

  /*
  |--------------------------------------------------------------------------
  | Location
  |--------------------------------------------------------------------------
  */

  if (!location || !String(location).trim()) {
    errors.location = 'Location is required';
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


module.exports = {
  validateCreateCompany,
  validateCompanyQuery,
};