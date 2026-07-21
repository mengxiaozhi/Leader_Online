const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeOrderContact,
  orderContactConfirmationMatches,
  buildOrderContactSnapshot,
} = require('../src/services/order-contact-confirmation');

test('order contact confirmation compares normalized current profile data', () => {
  const current = {
    username: '王 小明',
    email: 'Member@Example.com',
    phone: '0912-345-678',
    remittanceLast5: '12345',
  };
  const submitted = {
    username: '  王   小明 ',
    email: 'member@example.COM',
    phone: '0912345678',
    remittance_last5: '12345',
  };

  assert.deepEqual(normalizeOrderContact(submitted), {
    username: '王 小明',
    email: 'member@example.com',
    phone: '0912345678',
    remittanceLast5: '12345',
  });
  assert.equal(orderContactConfirmationMatches(current, submitted), true);
  assert.equal(orderContactConfirmationMatches(current, { ...submitted, phone: '0900000000' }), false);
  assert.equal(orderContactConfirmationMatches(current, { ...submitted, username: '' }), false);
});

test('order contact snapshots are server-authored and timestamped', () => {
  assert.deepEqual(
    buildOrderContactSnapshot({
      username: ' 王小明 ',
      email: 'MEMBER@example.com',
      phone: '0912-345-678',
      remittance_last5: '12345',
    }, new Date('2026-07-21T08:00:00.000Z')),
    {
      username: '王小明',
      email: 'member@example.com',
      phone: '0912-345-678',
      remittanceLast5: '12345',
      confirmedAt: '2026-07-21T08:00:00.000Z',
    }
  );
});
