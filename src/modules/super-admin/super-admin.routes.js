const express = require('express');

const protect = require('../../middleware/auth.middleware');
const authorize = require('../../middleware/role.middleware');

const {
  validateCreateCompany,
  validateCompanyQuery,
} = require('./Company.validator');

const {
  createCompany,
  getAllCompanies,
  getCompanyById,
  getDashboard,
  getRevenue,
  exportRevenue,
} = require('./Company.controller');

const router = express.Router();

console.log('✅ Super Admin Routes Loaded');


/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

router.get(
  '/dashboard',
  protect,
  authorize('superAdmin'),
  getDashboard
);


/*
|--------------------------------------------------------------------------
| COMPANIES
|--------------------------------------------------------------------------
*/


// Get all registered companies
router.get(
  '/companies',
  protect,
  authorize('superAdmin'),
  validateCompanyQuery,
  getAllCompanies
);


// Get single company
router.get(
  '/companies/:companyId',
  protect,
  authorize('superAdmin'),
  getCompanyById
);


// Add new company
router.post(
  '/companies',
  protect,
  authorize('superAdmin'),
  validateCreateCompany,
  createCompany
);


/*
|--------------------------------------------------------------------------
| REVENUE
|--------------------------------------------------------------------------
*/


// Revenue dashboard
router.get(
  '/revenue',
  protect,
  authorize('superAdmin'),
  getRevenue
);


// Export revenue CSV
router.get(
  '/revenue/export',
  protect,
  authorize('superAdmin'),
  exportRevenue
);


module.exports = router;