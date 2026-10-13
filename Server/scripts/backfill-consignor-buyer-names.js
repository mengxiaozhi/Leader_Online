'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { backfillBuyerConsignorNames, rollbackBuyerConsignorNames } = require('../src/services/consignor-buyer-backfill');

function parseArguments(args) {
  const options = { apply: false, backupPath: '', rollbackPath: '' };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('參數不可重複');
    seen.add(flag);
    if (flag === '--apply') options.apply = true;
    else if (flag === '--backup' || flag === '--rollback') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('備份或還原必須提供檔案路徑');
      options[flag === '--backup' ? 'backupPath' : 'rollbackPath'] = value;
    } else throw new Error('不支援的參數');
  }
  if (options.apply && (!options.backupPath || options.rollbackPath)) throw new Error('套用需要新的 --backup 路徑，且不可同時還原');
  if (options.backupPath && !options.apply) throw new Error('--backup 必須搭配 --apply');
  return options;
}

async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('預覽：node scripts/backfill-consignor-buyer-names.js\n套用：加上 --apply --backup <新的備份檔路徑>\n還原：加上 --rollback <備份檔路徑>');
    return;
  }
  const { apply, backupPath, rollbackPath } = parseArguments(args);
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  const connection = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME || 'leader_online',
    supportBigNumbers: true, bigNumberStrings: true });
  try {
    const report = rollbackPath
      ? await rollbackBuyerConsignorNames(connection, JSON.parse(await fs.readFile(rollbackPath, 'utf8')))
      : await backfillBuyerConsignorNames(connection, { apply, writeBackup: async plan => {
        const file = await fs.open(path.resolve(backupPath), 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(plan, null, 2)); await file.sync(); }
        finally { await file.close(); }
      } });
    // Counts/IDs only: do not print customer names or connection credentials.
    console.log(JSON.stringify(report, null, 2));
  } finally { await connection.end(); }
}

if (require.main === module) main().catch(error => {
  console.error(error.code || error.message || 'BACKFILL_FAILED'); process.exitCode = 1;
});
module.exports = { main, parseArguments };
