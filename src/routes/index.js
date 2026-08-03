const express = require('express');
const companyRoutes = require('../modules/companies/company.routes');

const router = express.Router();

router.use('/company', companyRoutes);

module.exports = router;
