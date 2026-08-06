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
const projectProgressRoutes = require('../modules/companies/project.progress.routes');

// Mount Routes
router.use('/auth', authRoutes);
router.use('/super-admin', superAdminRoutes);
router.use('/company', companyRoutes);
router.use('/company/projects', projectProgressRoutes);
router.use('/team-leader', teamLeaderRoutes);
router.use('/team-member', teamMemberRoutes);
router.use('/client', clientUserRoutes);

// Compatibility route
router.use('/login', (req, res, next) => {
    req.url = '/login';
    authRoutes(req, res, next);
});

// Dev Token
router.post('/dev/super-admin-token', (req, res) => {
    const token = jwt.sign(
        {
            id: 9999,
            email: 'super-admin@local.test',
            role: 'super_admin'
        },
        process.env.JWT_SECRET || 'dev-super-admin-secret',
        { expiresIn: '1h' }
    );

    res.json({
        success: true,
        message: 'Temporary super-admin token created',
        token
    });
});

module.exports = router;