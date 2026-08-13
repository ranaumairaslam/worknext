module.exports = function authorize(...requiredRoles) {
  const allowed = requiredRoles.map((role) =>
    role === 'superAdmin' ? 'super_admin' : role
  );

  return (req, res, next) => {
    const userRole = req.user?.role;
    const normalizedUserRole =
      userRole === 'superAdmin' ? 'super_admin' : userRole;

    if (!normalizedUserRole || !allowed.includes(normalizedUserRole)) {
      return res.status(403).json({
        success: false,
        code: 403,
        message: 'Forbidden',
      });
    }

    next();
  };
};
