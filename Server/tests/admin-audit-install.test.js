'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { migrationPath } = require('../scripts/install-audit');

test('audit migration ships inside standalone Server deployments and matches the canonical schema', () => {
  const file = migrationPath();
  assert.equal(path.relative(path.resolve(__dirname, '..'), file), 'migrations/058_admin_audit.sql');
  assert.equal(fs.readFileSync(file, 'utf8'), fs.readFileSync(path.resolve(__dirname, '../../Database/migrations/058_admin_audit.sql'), 'utf8'));
});
