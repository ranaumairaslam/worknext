const express = require('express');
const protect = require('../middleware/auth.middleware');
const authorize = require('../middleware/role.middleware');
const {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  resetCompanyPassword,
  setCompanyStatus,
  getDashboard
} = require('../controllers/company.controller');

const router = express.Router();

// Workflow: Login -> Manage Companies -> Company Created
// All routes below require an authenticated super_admin session.
router.use(protect, authorize('super_admin'));

router.get('/dashboard', getDashboard);

// Manage Companies
router.get('/companies', getCompanies);
router.get('/companies/:id', getCompanyById);
router.post('/companies', createCompany);            // -> Company Created (unique email + password issued)
router.patch('/companies/:id', updateCompany);
router.patch('/companies/:id/status', setCompanyStatus);
router.post('/companies/:id/reset-password', resetCompanyPassword);

module.exports = router;