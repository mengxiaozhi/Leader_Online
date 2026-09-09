'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { calculatePricing } = require('../src/services/managed-order-pricing');

// Execute the real email renderer with transport/config stubs, without booting the DB-backed context.
function renderer() {
  const source = fs.readFileSync(require.resolve('../src/context'), 'utf8');
  const email = source.slice(source.indexOf('async function sendOrderNotificationEmail('), source.indexOf('/** ======== Ticket expiry reminders'));
  const amounts = source.slice(source.indexOf('function toSafeNumber('), source.indexOf('async function getUserContact('));
  const mails = [];
  const ctx = vm.createContext({
    mailerReady: true, process: { env: {} }, console,
    EMAIL_FROM_NAME: 'Test', EMAIL_FROM_ADDRESS: 'sender@example.test', EMAIL_THEME: {},
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
    buildLeaderEmailHtml: options => `${options.childrenHtml}<a href="${options.actionUrl}">${options.actionText}</a>`,
    defaultRemittanceDetails: () => ({}), resolveOrderEmailCcRecipients: async () => [],
    transporter: { sendMail: async mail => mails.push(mail) },
  });
  vm.runInContext(`${amounts}\n${email}`, ctx);
  return { mails, send: options => ctx.sendOrderNotificationEmail({ to: 'member@example.test', type: 'updated', ...options }) };
}

for (const totalOverride of [0, 120.25]) test(`general edited email displays ${totalOverride} and a separate signed adjustment`, async () => {
  const r = renderer();
  const pricing = calculatePricing([{ key: 'ticket', name: '票券', quantity: 1, baseUnitPrice: 100 }], null, { unitPriceOverrides: { ticket: 80.25 }, totalOverride });
  const order = { id: 7, code: 'PRICE-7', remittance: { bankAccount: 'TEST-BANK' }, detailsRaw: { quantity: 1, total: totalOverride, pricing } };
  assert.equal((await r.send({ orders: [order] })).mailed, true);
  const html = r.mails[0].html;
  assert.ok(html.includes(`NT$ ${totalOverride}`));
  assert.ok(html.includes('既有折抵'));
  assert.ok(html.includes('人工調整差額'));
  assert.ok(html.includes(totalOverride === 0 ? '-NT$ 80.25' : '+NT$ 40'));
  assert.ok(html.includes('/store?orders=1&category=general'));
  if (totalOverride === 0) {
    assert.ok(html.includes('此訂單免匯款'));
    assert.ok(!html.includes('TEST-BANK'));
    await r.send({ type: 'completed', orders: [order] });
    assert.ok(!r.mails[1].html.includes('我們已收到您的匯款'));
  }
});
