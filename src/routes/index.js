const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Import Route Modules
const authRoutes = require('../modules/auth/auth.routes');
const superAdminRoutes = require('../modules/super-admin/super-admin.routes');
const companyRoutes = require('../modules/companies/company.routes');
const teamLeaderRoutes = require('../modules/teams/team-leader.routes');
const teamMemberRoutes = require('../modules/teams/team-member.routes');
const clientUserRoutes = require('../modules/clients/client-user.routes');

// Mount Route Modules
router.use('/auth', authRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/company', companyRoutes);
router.use('/team-leader', teamLeaderRoutes);
router.use('/team-member', teamMemberRoutes);
router.use('/client', clientUserRoutes);

// Compatibility route delegation for /api/login -> /api/auth/login
router.use('/login', (req, res, next) => {
  req.url = '/login';
  authRoutes(req, res, next);
});

// Temporary helper for local testing of protected routes (/api/dev/super-admin-token)
router.post('/dev/super-admin-token', (req, res) => {
  const token = jwt.sign(
    { id: 9999, email: 'super-admin@local.test', role: 'super_admin' },
    process.env.JWT_SECRET || 'dev-super-admin-secret',
    { expiresIn: '1h' }
  );

  res.status(200).json({ success: true, message: 'Temporary super-admin token created', token });
});

module.exports = router;
