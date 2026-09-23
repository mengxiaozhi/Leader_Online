'use strict';
function actionFor(method, route, params = {}) {
  if (route === '/logout') return 'logout';
  if (/login|magic_link|\/auth\/.*(?:callback|verify)/.test(route)) return 'login';
  if (/\/(?:export|download)(?:\/|$)/.test(route)) return 'export';
  const action = String(params.action || '').toLowerCase();
  const verbs = ['mark-reviewing', 'confirm-payment', 'retry-fulfillment', 'reissue', 'void', 'refund', 'approve', 'reject', 'issue', 'cancel', 'restore', 'transfer', 'merge', 'assign', 'publish', 'unpublish', 'attend', 'pause', 'resume', 'delete'];
  if (verbs.includes(action)) return action;
  if (/scan/.test(route)) return 'scan';
  for (const verb of verbs) if (new RegExp(`/(?:${verb})(?:/|$)`).test(route)) return verb;
  return ({ POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' })[method] || 'operation';
}
module.exports = { actionFor };
