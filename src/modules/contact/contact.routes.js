const express = require('express');
const { submitContactMessage } = require('./contact.controller');

const router = express.Router();

const methodNotAllowed = (allowed) => (req, res) => {
  res.set('Allow', allowed.join(', '));
  return res.status(405).json({
    success: false,
    code: 405,
    message: `Method ${req.method} not allowed. Allowed: ${allowed.join(', ')}`,
  });
};

router
  .route('/')
  .post(submitContactMessage)
  .all(methodNotAllowed(['POST']));

module.exports = router;
