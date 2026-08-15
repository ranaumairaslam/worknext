const express = require('express');

const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const {
  validateCreateCompany,
  validateCompanyQuery,
} = require('./Company.validator');

const {
  handleCreateCompanyUpload,
  normalizeCreateCompanyFields,
} = require('./Company.middleware');

const {
  createCompany,
  getAllCompanies,
  getCompanyById,
  getDashboard,
  getRevenue,
  exportRevenue,
} = require('./Company.controller');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

const superAdminOnly = [protect, authorize('super_admin')];

console.log('✅ Super Admin Routes Loaded');

router
  .route('/dashboard')
  .get(...superAdminOnly, getDashboard)
  .all(methodNotAllowed(['GET']));

router
  .route('/companies')
  .get(...superAdminOnly, validateCompanyQuery, getAllCompanies)
  .post(
    ...superAdminOnly,
    handleCreateCompanyUpload,
    normalizeCreateCompanyFields,
    validateCreateCompany,
    createCompany
  )
  .all(methodNotAllowed(['GET', 'POST']));

router
  .route('/companies/:companyId')
  .get(...superAdminOnly, getCompanyById)
  .all(methodNotAllowed(['GET']));

router
  .route('/revenue/export')
  .get(...superAdminOnly, exportRevenue)
  .all(methodNotAllowed(['GET']));

router
  .route('/revenue')
  .get(...superAdminOnly, getRevenue)
  .all(methodNotAllowed(['GET']));

module.exports = router;
