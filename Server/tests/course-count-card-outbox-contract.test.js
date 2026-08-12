'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('count-card booking queues inside its transaction and direct email is only a fallback', () => {
  const routes = read('src/routes/courses.js');
  const start = routes.indexOf("router.post('/courses/sessions/:id/book'");
  const end = routes.indexOf("router.delete('/courses/bookings/:id'", start);
  const booking = routes.slice(start, end);
  const enqueueAt = booking.indexOf('enqueueNotificationOutbox(conn');
  const commitAt = booking.lastIndexOf('await conn.commit()');
  assert.ok(enqueueAt > 0, 'booking must enqueue its durable notification');
  assert.ok(commitAt > enqueueAt, 'outbox row must be written before the business commit');
  assert.match(booking, /eventType: 'COUNT_BOOKING_CREATED'/);
  assert.match(booking, /if \(!bookingNotification\.queued\)[\s\S]*sendCourseNotificationEmail/);
});

test('attendance invite create and expiry share the 053 outbox path', () => {
  const domain = read('src/services/course-v2-domain.js');
  const createStart = domain.indexOf('async function createAttendanceInvite');
  const createEnd = domain.indexOf('async function createWalkIn', createStart);
  const expiryStart = domain.indexOf('async function processDueAttendanceInvites');
  const expiryEnd = domain.indexOf('async function processDueAutoNoShows', expiryStart);
  const createInvite = domain.slice(createStart, createEnd);
  const expireInvites = domain.slice(expiryStart, expiryEnd);
  assert.match(createInvite, /enqueueNotificationOutbox\(conn[\s\S]*COUNT_ATTENDANCE_INVITE_CREATED/);
  assert.match(createInvite, /inviteToken: rawToken/);
  assert.match(expireInvites, /COUNT_ATTENDANCE_INVITE_EXPIRED/g);
  assert.match(expireInvites, /status: 'auto_redeemed'[\s\S]*notificationQueued/);

  const routes = read('src/routes/course-v2.js');
  const routeStart = routes.indexOf("router.post('/admin/courses/sessions/:id/attendance-invites'");
  const routeEnd = routes.indexOf("router.get('/admin/courses/attendance-invites'", routeStart);
  const inviteRoute = routes.slice(routeStart, routeEnd);
  assert.match(inviteRoute, /result\.notificationQueued[\s\S]*deliveryStatus/);
  assert.match(inviteRoute, /!result\.notificationQueued[\s\S]*transporter\.sendMail/);
});

test('every partial-transfer transition emits a provider-scoped deduplicated event', () => {
  const domain = read('src/services/course-v2-domain.js');
  for (const eventType of [
    'COUNT_PARTIAL_TRANSFER_INITIATED',
    'COUNT_PARTIAL_TRANSFER_ACCEPTED',
    'COUNT_PARTIAL_TRANSFER_DECLINED',
    'COUNT_PARTIAL_TRANSFER_CANCELLED',
    'COUNT_PARTIAL_TRANSFER_EXPIRED',
  ]) {
    assert.match(domain, new RegExp(eventType));
  }
  assert.match(domain, /requireProviderAdvancedPayments: true/);
  assert.match(domain, /count-partial-transfer:\$\{transferId\}:[\s\S]*:\$\{role\}/);
  assert.match(domain, /async function processDuePartialTransfers[\s\S]*expireLockedPartialTransfer/);
});

test('fixed-term and count-card code delegate to one shared outbox enqueue implementation', () => {
  const term = read('src/services/course-term-domain.js');
  const countCard = read('src/services/course-v2-domain.js');
  const outbox = read('src/services/course-notification-outbox.js');
  assert.match(term, /enqueueCourseNotificationOutbox/);
  assert.match(countCard, /enqueueCourseNotificationOutbox/);
  assert.match(outbox, /async function enqueueCourseNotificationOutbox/);
  assert.equal((outbox.match(/INSERT INTO course_notification_outbox/g) || []).length, 1);
});
