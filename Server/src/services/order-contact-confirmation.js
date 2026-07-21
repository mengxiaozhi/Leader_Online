const { normalizeRegistrationName } = require('../security/registration-name');

function normalizeOrderContact(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    username: normalizeRegistrationName(source.username ?? source.name),
    email: String(source.email || '').trim().toLowerCase(),
    phone: String(source.phone || '').replace(/\D/g, ''),
    remittanceLast5: String(source.remittanceLast5 ?? source.remittance_last5 ?? '').trim(),
  };
}

function orderContactConfirmationMatches(current, submitted) {
  const expected = normalizeOrderContact(current);
  const actual = normalizeOrderContact(submitted);
  return Boolean(
    expected.username
    && expected.email
    && expected.phone
    && /^\d{5}$/.test(expected.remittanceLast5)
    && expected.username === actual.username
    && expected.email === actual.email
    && expected.phone === actual.phone
    && expected.remittanceLast5 === actual.remittanceLast5
  );
}

function buildOrderContactSnapshot(current, confirmedAt = new Date()) {
  const source = current && typeof current === 'object' ? current : {};
  const normalized = normalizeOrderContact(source);
  const timestamp = confirmedAt instanceof Date ? confirmedAt.toISOString() : String(confirmedAt || '');
  return {
    username: normalized.username,
    email: normalized.email,
    phone: String(source.phone || '').trim(),
    remittanceLast5: normalized.remittanceLast5,
    confirmedAt: timestamp,
  };
}

module.exports = {
  normalizeOrderContact,
  orderContactConfirmationMatches,
  buildOrderContactSnapshot,
};
