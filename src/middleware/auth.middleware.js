const jwt = require('jsonwebtoken');
const { normalizeRole } = require('./role.middleware');

module.exports = function protect(req, res, next) {
  let token;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.user.role = normalizeRole(decoded.role);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token is invalid or expired',
    });
  }
};
