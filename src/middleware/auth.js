const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ fejl: 'Ikke logget ind' });
  }
  try {
    req.bruger = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ fejl: 'Session udløbet — log ind igen' });
  }
}

function requireGodkendt(req, res, next) {
  if (!req.bruger.godkendt) {
    return res.status(403).json({
      fejl: 'Din konto afventer godkendelse',
      kode: 'AFVENTER_GODKENDELSE'
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.bruger.er_admin) {
    return res.status(403).json({ fejl: 'Kun admins har adgang' });
  }
  next();
}

module.exports = { requireAuth, requireGodkendt, requireAdmin };
