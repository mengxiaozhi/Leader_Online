'use strict';
const fs = require('fs');
const path = require('path');
const { operationFor, moduleFor } = require('../src/services/audit/runtime');
const { actionFor } = require('../src/services/audit/actions');
function routeInventory() {
  const directory = path.join(__dirname, '../src/routes');
  const entries = [];
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\2/g)) {
      const method = match[1].toUpperCase(); const route = match[3];
      const header = source.slice(match.index + match[0].length, match.index + match[0].length + 150);
      const managementGuard = /^\s*,\s*(?:adminOnly|staffRequired|adminOrEditorOnly|productManagerOnly|eventManagerOnly|reservationManagerOnly|scanAccessOnly|serviceProviderOnly|driverOnly|deliveryPointOnly|courseManagerRequired)\b/.test(header);
      const always = operationFor(method, route, false);
      const staff = operationFor(method, route, true);
      if (managementGuard && !['GET', 'HEAD'].includes(method) && !always) throw new Error(`Uncovered management guard: ${method} ${route}`);
      if (!always && !staff) continue;
      entries.push({ method, route, module: moduleFor(route), action: actionFor(method, route), policy: always ? 'always' : 'verified-staff-only', source: `${file}:${source.slice(0, match.index).split('\n').length}` });
    }
  }
  return entries;
}
if (require.main === module) console.log(JSON.stringify(routeInventory(), null, 2));
module.exports = { routeInventory };
