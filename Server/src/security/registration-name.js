const REGISTRATION_NAME_MIN_LENGTH = 2;
const REGISTRATION_NAME_MAX_LENGTH = 50;

function normalizeRegistrationName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isValidRegistrationName(value) {
  const normalized = normalizeRegistrationName(value);
  return normalized.length >= REGISTRATION_NAME_MIN_LENGTH
    && normalized.length <= REGISTRATION_NAME_MAX_LENGTH;
}

module.exports = {
  REGISTRATION_NAME_MIN_LENGTH,
  REGISTRATION_NAME_MAX_LENGTH,
  normalizeRegistrationName,
  isValidRegistrationName,
};
