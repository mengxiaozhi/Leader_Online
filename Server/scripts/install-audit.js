'use strict';
// Explicit deployment operation. Stop application writers while installing.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { inventory, buildTriggers, q, assertSchema } = require('../src/services/audit/schema');
async function main() {
  const db = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'leader_online', multipleStatements: true });
  try {
    if (process.argv.includes('--check')) {
      const tables = await assertSchema(db);
      console.log(`Audit schema verified: ${tables.size} tables.`);
      return;
    }
    await db.query(fs.readFileSync(path.resolve(__dirname, '../../Database/migrations/058_admin_audit.sql'), 'utf8'));
    const tables = await inventory(db);
    // Validate every table before replacing any triggers.
    const triggers = [...tables].flatMap(([table, columns]) => buildTriggers(table, columns, tables));
    for (const trigger of triggers) {
      await db.query(`DROP TRIGGER IF EXISTS ${q(trigger.name)}`);
      await db.query(trigger.sql);
    }
    await assertSchema(db);
    console.log(`Audit ready: ${tables.size} tables, ${triggers.length} triggers.`);
  } finally { await db.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
