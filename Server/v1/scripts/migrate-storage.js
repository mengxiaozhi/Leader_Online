#!/usr/bin/env node
/*
 * Legacy image migration script
 * Moves BLOB-backed checklist photos, event covers, and ticket covers to disk storage.
 */
const path = require('path');
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');
const storage = require('../storage');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const CHECKLIST_STAGES = new Set(['pre_dropoff', 'pre_pickup', 'post_dropoff', 'post_pickup']);

const buildChecklistStoragePath = (reservationId, stage, extension) => {
  const safeReservation = String(reservationId || '').trim().replace(/[^\d]/g, '') || 'unknown';
  const normalizedStage = CHECKLIST_STAGES.has(String(stage || '').toLowerCase())
    ? String(stage).toLowerCase()
    : 'unknown';
  const key = randomUUID().replace(/-/g, '');
  const ext = extension ? String(extension).replace(/^[.]+/, '') : 'bin';
  return path.posix.join('checklists', normalizedStage, safeReservation, `${Date.now()}-${key}.${ext}`);
};

const buildEventCoverStoragePath = (eventId, extension) => {
  const safeEvent = String(eventId || '').trim().replace(/[^\d]/g, '') || 'unknown';
  const key = randomUUID().replace(/-/g, '');
  const ext = extension ? String(extension).replace(/^[.]+/, '') : 'bin';
  return path.posix.join('event_covers', safeEvent, `${Date.now()}-${key}.${ext}`);
};

const sanitizeTicketType = (type) => {
  if (!type) return 'default';
  return String(type)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'default';
};

const buildTicketCoverStoragePath = (type, extension) => {
  const safeType = sanitizeTicketType(type).slice(0, 64) || 'default';
  const key = randomUUID().replace(/-/g, '');
  const ext = extension ? String(extension).replace(/^[.]+/, '') : 'bin';
  return path.posix.join('ticket_covers', safeType, `${Date.now()}-${key}.${ext}`);
};

const toExtension = (mime) => storage.mimeToExtension(mime || 'application/octet-stream');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'leader_online',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_POOL || '10', 10),
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci'
  });

  await storage.ensureStorageRoot();

  const migrateChecklistPhotos = async () => {
    const [rows] = await pool.query(
      `SELECT id, reservation_id, stage, mime, data
         FROM reservation_checklist_photos
        WHERE storage_path IS NULL AND data IS NOT NULL`
    );
    if (!rows.length) {
      console.log('Checklist photos already migrated.');
      return;
    }
    console.log(`Migrating ${rows.length} checklist photos...`);
    for (const row of rows) {
      if (!row.data) continue;
      const extension = toExtension(row.mime);
      let storagePath = null;
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        const candidate = buildChecklistStoragePath(row.reservation_id, row.stage, extension);
        try {
          await storage.writeBuffer(candidate, row.data, { mode: 0o600 });
          storagePath = storage.normalizeRelativePath(candidate);
          break;
        } catch (err) {
          if (err?.code === 'EEXIST' && attempts < 5) continue;
          throw err;
        }
      }
      if (!storagePath) continue;
      const checksum = storage.hashBuffer(row.data);
      await pool.query(
        'UPDATE reservation_checklist_photos SET storage_path = ?, checksum = ?, data = NULL WHERE id = ?',
        [storagePath, checksum, row.id]
      );
    }
    console.log('Checklist photos migration completed.');
  };

  const migrateEventCovers = async () => {
    const [rows] = await pool.query(
      `SELECT id, cover_type, cover_data
         FROM events
        WHERE cover_path IS NULL AND cover_data IS NOT NULL`
    );
    if (!rows.length) {
      console.log('Event covers already migrated.');
      return;
    }
    console.log(`Migrating ${rows.length} event covers...`);
    for (const row of rows) {
      if (!row.cover_data) continue;
      const extension = toExtension(row.cover_type);
      let storagePath = null;
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        const candidate = buildEventCoverStoragePath(row.id, extension);
        try {
          await storage.writeBuffer(candidate, row.cover_data, { mode: 0o600 });
          storagePath = storage.normalizeRelativePath(candidate);
          break;
        } catch (err) {
          if (err?.code === 'EEXIST' && attempts < 5) continue;
          throw err;
        }
      }
      if (!storagePath) continue;
      await pool.query(
        'UPDATE events SET cover_path = ?, cover_data = NULL WHERE id = ?',
        [storagePath, row.id]
      );
    }
    console.log('Event covers migration completed.');
  };

  const migrateTicketCovers = async () => {
    const [rows] = await pool.query(
      `SELECT type, cover_type, cover_data
         FROM ticket_covers
        WHERE storage_path IS NULL AND cover_data IS NOT NULL`
    );
    if (!rows.length) {
      console.log('Ticket covers already migrated.');
      return;
    }
    console.log(`Migrating ${rows.length} ticket covers...`);
    for (const row of rows) {
      if (!row.cover_data) continue;
      const extension = toExtension(row.cover_type);
      let storagePath = null;
      let attempts = 0;
      while (attempts < 5) {
        attempts += 1;
        const candidate = buildTicketCoverStoragePath(row.type, extension);
        try {
          await storage.writeBuffer(candidate, row.cover_data, { mode: 0o600 });
          storagePath = storage.normalizeRelativePath(candidate);
          break;
        } catch (err) {
          if (err?.code === 'EEXIST' && attempts < 5) continue;
          throw err;
        }
      }
      if (!storagePath) continue;
      await pool.query(
        'UPDATE ticket_covers SET storage_path = ?, cover_data = NULL WHERE type = ?',
        [storagePath, row.type]
      );
    }
    console.log('Ticket covers migration completed.');
  };

  try {
    await migrateChecklistPhotos();
    await migrateEventCovers();
    await migrateTicketCovers();
  } finally {
    await pool.end();
  }

  console.log('Migration finished successfully.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
