const express = require('express');
const buildHealthRoutes = require('./routes/health');
const buildAccountRoutes = require('./routes/account');
const buildCatalogRoutes = require('./routes/catalog');
const buildHandoverScheduleRoutes = require('./routes/handover-schedule');
const buildTicketRoutes = require('./routes/tickets');
const buildReservationRoutes = require('./routes/reservations');
const buildOrderRoutes = require('./routes/orders');
const buildCourseRoutes = require('./routes/courses');

function buildRouter(ctx) {
  const router = express.Router();
  router.use(buildHealthRoutes(ctx));
  router.use(buildAccountRoutes(ctx));
  router.use(buildCatalogRoutes(ctx));
  router.use(buildHandoverScheduleRoutes(ctx));
  router.use(buildTicketRoutes(ctx));
  router.use(buildReservationRoutes(ctx));
  router.use(buildOrderRoutes(ctx));
  router.use(buildCourseRoutes(ctx));
  return router;
}

module.exports = buildRouter;
