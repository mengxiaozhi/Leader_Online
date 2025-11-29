const express = require('express');

function buildHealthRoutes({ ok, ALLOW_ORIGINS }) {
  const router = express.Router();

  router.get('/healthz', (req, res) => ok(res, { uptime: process.uptime() }, 'OK'));

  router.get('/__debug/echo', (req, res) => {
    res.json({
      host: req.headers.host,
      origin: req.headers.origin || null,
      secure: req.secure,
      cookies_seen: Object.keys(req.cookies || {}),
      has_auth_token: Boolean(req.cookies?.auth_token),
      cors_allow_origins: ALLOW_ORIGINS,
    });
  });

  return router;
}

module.exports = buildHealthRoutes;
