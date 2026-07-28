const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_POLICY,
  compareEligibleTickets,
  derivePendingReview,
  resolveCourseCapabilities,
  resolveCoursePolicy,
  selectEligibleTicket,
  taipeiDateTimeMs,
} = require('../src/services/course-v2-policy');

test('MySQL DATETIME values are interpreted as Asia/Taipei wall-clock time', () => {
  assert.equal(
    taipeiDateTimeMs('2026-07-30 09:00:00'),
    Date.parse('2026-07-30T09:00:00+08:00')
  );
  assert.equal(
    taipeiDateTimeMs('2026-07-30'),
    Date.parse('2026-07-30T00:00:00+08:00')
  );
});

test('session absolute values override relative defaults and ticket/scenario rules only narrow redemption', () => {
  const startsAt = '2026-07-30 09:00:00';
  const endsAt = '2026-07-30 11:00:00';
  const policy = resolveCoursePolicy({
    session: {
      startsAt,
      endsAt,
      bookingOpenAt: '2026-07-01 00:00:00',
      bookingOpenMinutesBefore: 10,
      redeemOpenMinutesBefore: 240,
      redeemCloseMinutesAfter: 360,
    },
    providerSettings: {
      bookingOpenMinutesBefore: 60,
      bookingCloseMinutesBefore: 30,
      cancelCloseMinutesBefore: 45,
      redeemOpenMinutesBefore: 180,
      redeemCloseMinutesAfter: 300,
    },
    platformSettings: DEFAULT_POLICY,
    scenario: {
      redeemOpenMinutesBefore: 120,
      redeemCloseMinutesAfter: 180,
    },
    ticketProduct: {
      redeemOpenMinutesBefore: 60,
      redeemCloseMinutesAfter: 90,
    },
    now: '2026-07-30 08:30:00',
  });

  assert.equal(policy.bookingOpenAt, taipeiDateTimeMs('2026-07-01 00:00:00'));
  assert.equal(policy.bookingCloseAt, taipeiDateTimeMs('2026-07-30 08:30:00'));
  assert.equal(policy.cancelCloseAt, taipeiDateTimeMs('2026-07-30 08:15:00'));
  assert.equal(policy.redeemOpenAt, taipeiDateTimeMs('2026-07-30 08:00:00'));
  assert.equal(policy.redeemCloseAt, taipeiDateTimeMs('2026-07-30 12:30:00'));
  assert.equal(policy.canBook, true);
  assert.equal(policy.canRedeemOnsite, true);
});

test('scenario edge and ticket redemption limits are intersected independently', () => {
  const policy = resolveCoursePolicy({
    session: {
      startsAt: '2026-07-30 09:00:00',
      endsAt: '2026-07-30 11:00:00',
      redeemOpenMinutesBefore: 240,
      redeemCloseMinutesAfter: 360,
    },
    scenario: {
      redeemOpenMinutesBefore: 120,
      redeemCloseMinutesAfter: 180,
    },
    allowedProduct: {
      redeemOpenMinutesBefore: 30,
      redeemCloseMinutesAfter: 90,
    },
    ticketProduct: {
      redeemOpenMinutesBefore: 60,
      redeemCloseMinutesAfter: 15,
    },
    now: '2026-07-30 08:45:00',
  });

  assert.equal(policy.redeemOpenAt, taipeiDateTimeMs('2026-07-30 08:30:00'));
  assert.equal(policy.redeemCloseAt, taipeiDateTimeMs('2026-07-30 11:15:00'));
  assert.equal(policy.canRedeemOnsite, true);
});

test('automatic ticket selection is scenario priority, expiry, issue time, then ticket id', () => {
  const candidates = [
    {
      id: 40,
      status: 'active',
      remainingUses: 2,
      activeHolds: 0,
      scenarioPriority: 2,
      expiresAt: '2026-08-01',
      issuedAt: '2026-06-01',
    },
    {
      id: 30,
      status: 'active',
      remainingUses: 2,
      activeHolds: 1,
      scenarioPriority: 1,
      expiresAt: '2026-09-01',
      issuedAt: '2026-05-01',
    },
    {
      id: 20,
      status: 'active',
      remainingUses: 1,
      activeHolds: 0,
      scenarioPriority: 1,
      expiresAt: '2026-08-15',
      issuedAt: '2026-07-01',
    },
    {
      id: 10,
      status: 'active',
      remainingUses: 1,
      activeHolds: 1,
      scenarioPriority: 0,
      expiresAt: '2026-07-31',
      issuedAt: '2026-04-01',
    },
  ];

  assert.equal(selectEligibleTicket(candidates).id, 20);
  assert.ok(compareEligibleTickets(candidates[2], candidates[1]) < 0);
});

test('pendingReview is derived only for booked reservations after redeem close', () => {
  const policy = { redeemCloseAt: taipeiDateTimeMs('2026-07-30 12:00:00') };
  assert.equal(
    derivePendingReview(
      { status: 'booked' },
      policy,
      '2026-07-30 12:00:01'
    ),
    true
  );
  assert.equal(
    derivePendingReview(
      { status: 'attended' },
      policy,
      '2026-07-30 12:00:01'
    ),
    false
  );
});

test('makeup eligibility begins after redeem close, never before the onsite window', () => {
  const session = {
    startsAt: '2026-07-30 09:00:00',
    endsAt: '2026-07-30 11:00:00',
    redeemOpenMinutesBefore: 120,
    redeemCloseMinutesAfter: 60,
  };
  const beforeOpen = resolveCoursePolicy({
    session,
    now: '2026-07-30 06:00:00',
  });
  const afterClose = resolveCoursePolicy({
    session,
    now: '2026-07-30 12:00:01',
  });
  assert.equal(beforeOpen.canRedeemOnsite, false);
  assert.equal(beforeOpen.pendingReview, false);
  assert.equal(afterClose.canRedeemOnsite, false);
  assert.equal(afterClose.pendingReview, true);
});

test('coach membership grants attendance only for an assigned session', () => {
  const membership = {
    role: 'coach',
    status: 'active',
    capabilities_json: JSON.stringify({
      manageCatalog: true,
      manageStaff: true,
      viewReports: true,
    }),
  };

  assert.deepEqual(resolveCourseCapabilities({
    platformRole: 'USER',
    membership,
    assignedCoach: false,
  }), {
    global: false,
    manageCatalog: false,
    manageSettings: false,
    manageStaff: false,
    manageAttendance: false,
    viewReports: false,
  });
  assert.equal(resolveCourseCapabilities({
    platformRole: 'USER',
    membership,
    assignedCoach: true,
  }).manageAttendance, true);
});
