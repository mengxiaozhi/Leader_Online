'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  STAGES, LABELS, scheduleFromRow, stageLocation, windowText,
} = require('../src/services/handover-schedule');

// Exercise the real notification composers without starting application timers,
// reading application credentials, or sending Email/LINE messages.
const source = fs.readFileSync(require.resolve('../src/context'), 'utf8');
function composers() {
  const ctx = vm.createContext({
    HANDOVER_STAGES: STAGES, HANDOVER_LABELS: LABELS,
    scheduleFromRow, stageLocation, handoverWindowText: windowText,
    formatDateRangeDisplay: () => '比賽日期',
    formatReservationDisplayId: value => `#${value}`,
    formatConsignorName: value => value || '未確認',
    getReservationStageCode: (_reservation, stage) => `${stage}-code`,
    buildQrUrl: code => `https://example.test/qr/${code}`,
    zhReservationStatus: stage => LABELS[stage] || stage,
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    EMAIL_THEME: {}, buildAmountBreakdownEntries: () => [], buildAmountBreakdownText: () => '',
    buildReservationFlexMessage: options => ({ type: 'flex', ...options }),
  });
  vm.runInContext(source.slice(source.indexOf('function summarizeReservationSchedule('), source.indexOf('async function notifyReservationStageChange(')), ctx);
  return ctx;
}

const context = (store = {}) => ({
  reservation: { id: 41, event: '測試比賽', store: '台北門市', ticket_type: '來回', consignor_name: '託運者' },
  event: { title: '測試比賽', location: 'A 比賽會場' },
  store: {
    name: 'B 台北門市', address: 'B 門市地址',
    pre_pickup_location: 'C 賽前取車區', post_dropoff_location: 'D 賽後交車區',
    ...store,
  },
});

test('payment and checklist Email/LINE distinguish race venue and all handover locations', () => {
  const c = composers();
  const payment = c.composeReservationPaymentContent({ contexts: [context()] });
  const paymentText = JSON.stringify(payment);
  assert.match(paymentText, /比賽會場/);
  assert.match(paymentText, /A 比賽會場/);
  for (const content of [payment, c.composeChecklistCompletionContent({ context: context(), stage: 'pre_dropoff' })]) {
    assert.match(content.emailHtml, /C 賽前取車區/);
    assert.match(content.emailHtml, /D 賽後交車區/);
    assert.match(JSON.stringify(content.lineMessages), /C 賽前取車區/);
    assert.match(JSON.stringify(content.lineMessages), /D 賽後交車區/);
    assert.match(content.emailHtml, /B 台北門市／B 門市地址/);
  }
});

for (const [stage, location] of [['pre_pickup', 'C 賽前取車區'], ['post_dropoff', 'D 賽後交車區'], ['post_pickup', 'B 台北門市／B 門市地址']]) {
  test(`${stage} progress messages use its actual location without venue fallback`, () => {
    const content = composers().composeStageProgressContent({ context: context(), stage });
    assert.match(content.emailHtml, new RegExp(location));
    assert.match(JSON.stringify(content.lineMessages), new RegExp(location));
    assert.ok(!JSON.stringify(content).includes('A 比賽會場'));
  });
}

test('unpublished locations remain pending and private location drafts do not leak into messages', () => {
  const ctx = context({
    pre_pickup_location: null, post_dropoff_location: null,
    handover_schedule_draft: { locations: { pre_pickup: 'PRIVATE PICKUP', post_dropoff: 'PRIVATE DROPOFF' } },
  });
  const summary = composers().summarizeReservationSchedule(ctx);
  assert.equal(summary.timings.stageLocations.pre_pickup, '地點待公布');
  assert.equal(summary.timings.stageLocations.post_dropoff, '地點待公布');
  assert.ok(summary.timings.handoverRows.some(row => row.value === '時間待公布'));
  const content = composers().composeStageProgressContent({ context: ctx, stage: 'pre_pickup' });
  assert.match(content.emailHtml, /地點待公布/);
  assert.ok(!JSON.stringify(content).includes('PRIVATE'));
  assert.ok(!JSON.stringify(content).includes('A 比賽會場'));
});

test('composers use the hydrated published schedule before raw or private values', () => {
  const ctx = context({ handoverSchedule: scheduleFromRow({ pre_pickup_location: '最新公開取車區', post_dropoff_location: null }) });
  const summary = composers().summarizeReservationSchedule(ctx);
  assert.equal(summary.timings.stageLocations.pre_pickup, '最新公開取車區');
  assert.equal(summary.timings.stageLocations.post_dropoff, '地點待公布');
});
