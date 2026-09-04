require('dotenv').config();

// Vercel serverless entry — export the Express app (do not call listen here).
module.exports = require('../src/app');
