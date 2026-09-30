/**
 * Middleware autentikasi berbasis session.
 * - requireAuth: melindungi halaman admin
 * - requireApiAuth: melindungi API admin (return JSON)
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.redirect('/admin/login');
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized. Login required.' });
}

module.exports = { requireAuth, requireApiAuth };
