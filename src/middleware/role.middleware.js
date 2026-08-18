function normalizeRole(role) {
  if (!role) return role;

  const value = String(role).trim();
  const lower = value.toLowerCase();

    const aliases = {
    superadmin: 'super_admin',
    super_admin: 'super_admin',
    company: 'company',
    companyadmin: 'company',
    company_admin: 'company',
    'company admin': 'company',
    teamleader: 'team_leader',
    team_leader: 'team_leader',
    leader: 'team_leader',
    teammember: 'team_member',
    team_member: 'team_member',
    member: 'team_member',
  };

  return aliases[lower] || lower;
}

module.exports = function authorize(...requiredRoles) {
  const allowed = requiredRoles.map((role) => normalizeRole(role));

  return (req, res, next) => {
    const normalizedUserRole = normalizeRole(req.user?.role);

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

module.exports.normalizeRole = normalizeRole;
