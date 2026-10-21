async function isAccountTombstoned(queryable, {
  provider = null,
  subject = null,
  email = null,
} = {}, { forUpdate = false } = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedSubject = String(subject || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const lock = forUpdate ? ' FOR UPDATE' : '';
  if (normalizedProvider && normalizedSubject) {
    const [rows] = await queryable.query(
      `SELECT id FROM account_tombstones WHERE provider = ? AND subject = ? LIMIT 1${lock}`,
      [normalizedProvider, normalizedSubject]
    );
    if (rows.length) return true;
  }
  if (normalizedEmail) {
    const [rows] = await queryable.query(
      `SELECT id FROM account_tombstones WHERE LOWER(email) = LOWER(?) LIMIT 1${lock}`,
      [normalizedEmail]
    );
    if (rows.length) return true;
  }
  // Lookup failures must propagate so registration cannot bypass deletion records.
  return false;
}

module.exports = { isAccountTombstoned };
