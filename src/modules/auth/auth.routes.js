const express = require('express');
const router = express.Router();

// placeholder auth routes
router.post('/login', (req, res) => res.status(200).json({ success: true, message: 'Auth route placeholder' }));

module.exports = router;
