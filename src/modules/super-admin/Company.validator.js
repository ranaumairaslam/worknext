const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCreateCompany(body) {
  const errors = [];
  const { companyName, ownerName, contactEmail, phone, website } = body;

  if (!companyName || !companyName.trim()) errors.push('companyName is required.');
  if (!ownerName || !ownerName.trim()) errors.push('ownerName is required.');

  // contactEmail is optional — it's the company's real-world contact address,
  // NOT the login email (the login email/password are system-generated).
  if (contactEmail && !EMAIL_REGEX.test(contactEmail)) {
    errors.push('contactEmail is not a valid email address.');
  }

  if (website && !/^https?:\/\/.+/i.test(website)) {
    errors.push('website must start with http:// or https://');
  }

  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
    errors.push('phone number format is invalid.');
  }

  return errors;
}

function validateUpdateCompany(body) {
  const errors = [];
  const { companyName, contactEmail, website, phone, status } = body;

  if (companyName !== undefined && !companyName.trim()) {
    errors.push('companyName cannot be empty.');
  }
  if (contactEmail && !EMAIL_REGEX.test(contactEmail)) {
    errors.push('contactEmail is not a valid email address.');
  }
  if (website && !/^https?:\/\/.+/i.test(website)) {
    errors.push('website must start with http:// or https://');
  }
  if (phone && !/^[0-9+\-\s()]{6,20}$/.test(phone)) {
    errors.push('phone number format is invalid.');
  }
  if (status !== undefined && !['active', 'inactive', 'suspended'].includes(status)) {
    errors.push('status must be one of: active, inactive, suspended.');
  }

  return errors;
}

module.exports = { validateCreateCompany, validateUpdateCompany };