const express = require('express');
const { createHash, randomBytes } = require('crypto');
const path = require('path');
const { parseImagePayload } = require('../utils/image-upload');
const { normalizeOrderContact, orderContactConfirmationMatches } = require('../services/order-contact-confirmation');
const { registerCourseV2Routes } = require('./course-v2');
const {
  createCourseV2Domain,
  mysqlDateTime: mysqlTaipeiDateTime,
} = require('../services/course-v2-domain');
const {
  resolveCoursePolicy,
  taipeiDateTimeMs,
} = require('../services/course-v2-policy');
const {
  shouldIncludeRequiredAddons,
  isBundleIssuableShopProductStatus,
  resolveReturningEligibility,
} = require('../services/course-v2-sales');
const {
  GoogleWalletConfigurationError,
  buildCourseBookingGoogleWalletSaveUrl,
  courseBookingDateTime,
} = require('../utils/google-wallet');

const COURSE_PRODUCT_STATUSES = new Set(['draft', 'published', 'archived']);
const COURSE_SESSION_STATUSES = new Set(['draft', 'open', 'closed', 'completed', 'cancelled']);
const COURSE_ORDER_STATUSES = new Set(['pending', 'payment_review', 'paid', 'issued', 'cancelled', 'refunded']);
const COURSE_TICKET_STATUSES = new Set(['pending', 'active', 'paused', 'exhausted', 'expired', 'void']);
const COURSE_PRODUCT_COVER_STORAGE_ROOT = 'course_product_covers';
const COURSE_REDEMPTION_EARLY_WINDOW_MS = 2 * 60 * 60 * 1000;
const COURSE_REDEMPTION_LATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const COURSE_USER_DATA_CONFIRMATION_VERSION = 1;
const COURSE_PROVIDER_ROLES = new Set(['SERVICE_PROVIDER', 'STORE', 'COACH']);
const COURSE_BOOKING_STATUSES = new Set(['booked', 'cancelled', 'attended', 'no_show']);

function text(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

function positiveInt(value, fallback = null, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function nonNegativeInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
}

function money(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : fallback;
}

function booleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function queryText(value, max = 255) {
  return text(firstValue(value), max);
}

function queryList(value, allowed = null) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(new Set(values
    .flatMap((entry) => String(entry ?? '').split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry && (!allowed || allowed.has(entry)))));
}

function queryDate(value) {
  const candidate = queryText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : '';
}

function queryBoolean(value) {
  const raw = firstValue(value);
  if (raw === undefined || raw === null || raw === '') return null;
  const normalized = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function encodeCourseActivityCursor(row = {}) {
  const createdAt = mysqlDateTime(row.created_at ?? row.createdAt);
  const id = text(row.id, 100);
  if (!createdAt || !id) return null;
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

function decodeCourseActivityCursor(value) {
  const candidate = text(value, 500);
  if (!candidate) return null;
  if (/^\d+$/.test(candidate)) {
    return { legacyOffset: nonNegativeInt(candidate, 0, Number.MAX_SAFE_INTEGER) };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(candidate)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(candidate, 'base64url').toString('utf8'));
    const createdAt = mysqlDateTime(parsed?.createdAt);
    const id = text(parsed?.id, 100);
    return createdAt && id ? { createdAt, id } : null;
  } catch (_) {
    return null;
  }
}

function firstOwnField(source, keys) {
  const object = source && typeof source === 'object' ? source : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return undefined;
}

function stableStringify(value, seen = new WeakSet()) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key], seen)}`).join(',')}}`;
}

function safeJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeCourseManagerRole(value) {
  const role = text(value, 32).toUpperCase();
  return COURSE_PROVIDER_ROLES.has(role) ? 'SERVICE_PROVIDER' : role;
}

function courseProviderFields(row = {}) {
  const providerUserId = row.owner_user_id || row.provider_user_id || null;
  return {
    providerUserId,
    provider_user_id: providerUserId,
    providerName: providerUserId ? (row.provider_name || '') : '',
    isPlatformCourse: !providerUserId,
  };
}

function mysqlDateTime(value, nullable = true) {
  if (value === undefined || value === null || value === '') return nullable ? null : '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return nullable ? null : '';
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function dateOnly(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function randomCode(prefix, bytes = 5) {
  return `${prefix}${randomBytes(bytes).toString('hex').toUpperCase()}`;
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = text(value, 32).toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeCourseCoverUrl(value, { strict = false } = {}) {
  const candidate = text(value, 1000);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
  } catch (_) {}
  if (strict) {
    throw Object.assign(new Error('封面圖片網址僅支援 http 或 https'), {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
    });
  }
  return null;
}

function normalizeCourseTransferEmail(value) {
  const email = text(value, 255).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeCourseUserDataField(key, value) {
  if (/email/i.test(key)) return normalizeCourseTransferEmail(value);
  if (/remittance/i.test(key)) return text(value, 5);
  return text(value, 255);
}

function courseUserDataConfirmationMatches(confirmation, expected = {}) {
  if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) return false;
  if (Number(confirmation.version) !== COURSE_USER_DATA_CONFIRMATION_VERSION || confirmation.confirmed !== true) return false;
  return Object.entries(expected).every(([key, value]) => (
    normalizeCourseUserDataField(key, confirmation[key]) === normalizeCourseUserDataField(key, value)
  ));
}

function escapeCourseEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCourseEmailAmount(value) {
  return `NT$ ${money(value).toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatCourseEmailDateTime(value) {
  if (!value && value !== 0) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return text(value, 100);
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildCourseNotificationEmail({
  subject,
  recipientName,
  intro,
  details = [],
  actionUrl,
  actionText,
  footer = '此信件由系統自動發送，請勿直接回覆。',
} = {}) {
  const safeSubject = text(subject, 255) || 'Leader Online 通知';
  const safeName = text(recipientName, 255);
  const safeDetails = (Array.isArray(details) ? details : [])
    .map((item) => ({ label: text(item?.label, 100), value: text(item?.value, 1000) }))
    .filter((item) => item.label && item.value);
  const detailRows = safeDetails.map(({ label, value }, index) => `
    <tr>
      <td style="padding:11px 14px;${index < safeDetails.length - 1 ? 'border-bottom:1px solid #d5dde8;' : ''}color:#64748b;width:32%;vertical-align:top;">${escapeCourseEmailHtml(label)}</td>
      <td style="padding:11px 14px;${index < safeDetails.length - 1 ? 'border-bottom:1px solid #d5dde8;' : ''}color:#1f2937;font-weight:500;">${escapeCourseEmailHtml(value)}</td>
    </tr>`).join('');
  const actionHtml = actionUrl ? `
    <p style="margin:20px 0 4px 0;">
      <a href="${escapeCourseEmailHtml(actionUrl)}" style="display:inline-block;background:#A9363C;color:#ffffff;text-decoration:none;border-radius:10px;padding:11px 17px;font-size:15px;font-weight:500;">${escapeCourseEmailHtml(actionText || '查看詳情')}</a>
    </p>` : '';
  const greeting = safeName ? `${safeName} 您好，` : '您好，';
  const html = `
<!doctype html>
<html lang="zh-Hant">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeCourseEmailHtml(safeSubject)}</title></head>
  <body style="margin:0;padding:0;background:#f7f8fa;font-family:Inter,'Segoe UI','Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8fa;padding:28px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #d5dde8;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:25px 28px 18px;border-bottom:1px solid #d5dde8;">
            <div style="font-size:13px;line-height:20px;color:#A9363C;font-weight:500;margin-bottom:8px;">Leader Online 課程中心</div>
            <h1 style="margin:0;color:#1f2937;font-size:24px;line-height:1.35;font-weight:500;">${escapeCourseEmailHtml(safeSubject)}</h1>
          </td></tr>
          <tr><td style="padding:22px 28px 24px;font-size:15px;line-height:1.8;color:#1f2937;">
            <p style="margin:0 0 8px;">${escapeCourseEmailHtml(greeting)}</p>
            <p style="margin:0 0 18px;color:#64748b;">${escapeCourseEmailHtml(intro || '')}</p>
            ${detailRows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #d5dde8;border-radius:14px;overflow:hidden;">${detailRows}</table>` : ''}
            ${actionHtml}
          </td></tr>
          <tr><td style="padding:17px 28px 24px;border-top:1px solid #d5dde8;background:#fbfcfd;color:#64748b;font-size:13px;line-height:1.7;">${escapeCourseEmailHtml(footer)}</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`.trim();
  const plainText = [
    safeSubject,
    '',
    greeting,
    text(intro, 1000),
    ...safeDetails.map(({ label, value }) => `${label}：${value}`),
    actionUrl ? `${actionText || '查看詳情'}：${actionUrl}` : '',
    footer,
  ].filter((line, index, list) => line || (index > 0 && list[index - 1])).join('\n');
  return { subject: safeSubject, html, text: plainText };
}

function buildCourseOrderConfirmationEmail({
  code,
  buyerName,
  productName,
  quantity,
  totalAmount,
  remittanceLast5,
  webBase,
} = {}) {
  const orderCode = text(code, 64);
  const details = [
    { label: '訂單編號', value: orderCode },
    { label: '課程', value: text(productName, 255) || '課程商品' },
    { label: '數量', value: String(positiveInt(quantity, 1, 10)) },
    { label: '總金額', value: formatCourseEmailAmount(totalAmount) },
    { label: '付款狀態', value: '待匯款／行政確認' },
  ];
  const last5 = text(remittanceLast5, 5);
  if (last5) details.push({ label: '匯款帳號後五碼', value: last5 });
  return buildCourseNotificationEmail({
    subject: `課程訂單已建立：${orderCode}`,
    recipientName: buyerName,
    intro: '我們已收到您的課程購買訂單。行政確認款項後會發行課程計次票，屆時即可預約開放場次。',
    details,
    actionUrl: `${String(webBase || '').replace(/\/$/, '')}/store?tab=courses&orders=1&category=course`,
    actionText: '查看課程訂單',
  });
}

function buildCourseBookingConfirmationEmail({
  bookingId,
  attendeeName,
  session,
  ticketCode,
  webBase,
} = {}) {
  const sessionTitle = text(session?.title, 255) || text(session?.code, 64) || '課程場次';
  const start = formatCourseEmailDateTime(session?.starts_at ?? session?.startsAt);
  const end = formatCourseEmailDateTime(session?.ends_at ?? session?.endsAt);
  const timeRange = start && end ? `${start} ～ ${end}` : start || end || '時間待公告';
  return buildCourseNotificationEmail({
    subject: `課程預約成功：${sessionTitle}`,
    recipientName: attendeeName,
    intro: '您已完成課程場次預約。預約當下不會扣除堂數，實際到場核銷時才會扣除 1 堂。',
    details: [
      { label: '預約編號', value: String(positiveInt(bookingId, 0)) },
      { label: '課程場次', value: sessionTitle },
      { label: '日期時間', value: timeRange },
      { label: '地點', value: text(session?.location, 255) || '地點待公告' },
      { label: '教練', value: text(session?.coach_name ?? session?.coachName, 255) || '教練待公告' },
      { label: '使用票券', value: text(ticketCode, 64) || '課程票券' },
    ],
    actionUrl: `${String(webBase || '').replace(/\/$/, '')}/wallet?tab=reservations&category=course`,
    actionText: '查看課程預約',
  });
}

function courseTicketTransferBlockReason(ticket, {
  hasActiveBooking = false,
  acceptedTransferCount = 0,
  now = Date.now(),
} = {}) {
  if (!ticket) return '找不到課程票券';
  const transferable = ticket.product_transferable_snapshot ?? ticket.transferable;
  if (!Number(transferable)) return '此票券目前不可轉讓';
  if (ticket.frozen_at ?? ticket.frozenAt) return '此票券目前已凍結，無法轉讓';
  if (!['pending', 'active'].includes(String(ticket.status || '').toLowerCase())) return '此票券目前不可轉讓';
  if (Number(ticket.remaining_uses_cache ?? ticket.remaining_uses ?? ticket.remainingUses ?? 0) <= 0) {
    return '此票券已無剩餘堂數，無法轉讓';
  }
  const maxTransfers = Number(ticket.product_max_transfers_snapshot ?? 1);
  if (Number(acceptedTransferCount || 0) >= maxTransfers) return '此票券已達轉讓次數上限';
  const expiresAt = ticket.expires_at ?? ticket.expiresAt;
  const today = courseCalendarDate(now);
  if (expiresAt) {
    const expiryDate = courseCalendarDate(expiresAt);
    if (expiryDate && today && expiryDate < today) return '此票券已過期，無法轉讓';
  }
  const activationDeadline = ticket.activation_deadline ?? ticket.activationDeadline;
  if (String(ticket.status || '').toLowerCase() === 'pending' && activationDeadline) {
    const activationDate = courseCalendarDate(activationDeadline);
    if (activationDate && today && activationDate < today) {
      return '此票券已超過開卡期限，無法轉讓';
    }
  }
  if (hasActiveBooking) return '此票券仍有未出席預約，請先取消預約再轉讓';
  return '';
}

function courseCalendarDate(value) {
  if (!value && value !== 0) return '';
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // Course expiry and activation deadlines are Taiwan calendar dates. Using
  // the server's local timezone makes UTC deployments accept yesterday's
  // expired tickets during Taiwan's first eight hours of the day.
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addCourseCalendarDays(value, days) {
  const calendarDate = courseCalendarDate(value);
  const parsedDays = nonNegativeInt(days, 0, 36500);
  if (!calendarDate) return '';
  const date = new Date(`${calendarDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + parsedDays);
  return date.toISOString().slice(0, 10);
}

function courseDateTimeMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const normalized = String(value ?? '').trim();
  if (!normalized) return NaN;
  return new Date(normalized).getTime();
}

function courseBookingRedemptionBlockReason(booking, { now = Date.now() } = {}) {
  if (!booking || String(booking.status || '').toLowerCase() !== 'booked') return '此預約目前不能核銷';
  const sessionStatus = String(booking.session_status || '').toLowerCase();
  if (sessionStatus === 'cancelled') return '課程場次已取消，不能核銷';
  if (!['open', 'closed', 'completed'].includes(sessionStatus)) return '課程場次尚未開放，不能核銷';
  if (!['pending', 'active'].includes(String(booking.ticket_status || '').toLowerCase())) return '課程票券目前不可核銷';
  if (Number(booking.remaining_uses || 0) <= 0) return '課程票券已無剩餘堂數';
  const nowMs = courseDateTimeMillis(now);
  const effectiveNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const startsAt = courseDateTimeMillis(booking.starts_at ?? booking.startsAt);
  if (Number.isFinite(startsAt) && effectiveNow < startsAt - COURSE_REDEMPTION_EARLY_WINDOW_MS) {
    return '課程尚未開放核銷';
  }
  const endsAt = courseDateTimeMillis(booking.ends_at ?? booking.endsAt);
  if (Number.isFinite(endsAt) && effectiveNow > endsAt + COURSE_REDEMPTION_LATE_WINDOW_MS) {
    return '課程核銷期限已截止';
  }
  const today = courseCalendarDate(new Date(effectiveNow));
  const expiresAt = courseCalendarDate(booking.ticket_expires_at);
  if (expiresAt && today && expiresAt < today) return '課程票券已過期，不能核銷';
  const activationDeadline = courseCalendarDate(booking.activation_deadline);
  if (String(booking.ticket_status || '').toLowerCase() === 'pending'
    && activationDeadline && today && activationDeadline < today) {
    return '課程票券已超過開卡期限，不能核銷';
  }
  return '';
}

function courseBookingGoogleWalletValidity(booking) {
  let startsAt;
  let endsAt;
  try {
    startsAt = courseBookingDateTime(
      booking?.startsAt ?? booking?.starts_at,
      '開始時間'
    ).getTime();
    endsAt = courseBookingDateTime(
      booking?.endsAt ?? booking?.ends_at,
      '結束時間'
    ).getTime();
  } catch (_) {
    return null;
  }
  if (endsAt <= startsAt) return null;
  return {
    validFrom: new Date(startsAt - COURSE_REDEMPTION_EARLY_WINDOW_MS).toISOString(),
    validUntil: new Date(endsAt + COURSE_REDEMPTION_LATE_WINDOW_MS).toISOString(),
  };
}

function isCourseTicketTransferCode(value) {
  return /^CTK-[A-Z0-9]+$/i.test(text(value, 64).replace(/\s+/g, ''));
}

function normalizeCourseBookingVerificationCode(value) {
  return text(value, 64).replace(/\s+/g, '').toUpperCase();
}

function isCourseBookingVerificationCode(value) {
  return /^CBK-[A-F0-9]{16,32}$/.test(normalizeCourseBookingVerificationCode(value));
}

function isCourseTicketTransferExpired(transfer, { now = Date.now() } = {}) {
  if (!transfer) return true;
  const createdAt = transfer.created_at instanceof Date
    ? transfer.created_at.getTime()
    : new Date(transfer.created_at).getTime();
  if (!Number.isFinite(createdAt)) return true;
  const maxAgeMs = transfer.code ? 15 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return now - createdAt >= maxAgeMs;
}

function toCourseTicketTransferLog(row = {}, userId = null) {
  return {
    id: Number(row.id),
    ticket_id: row.ticket_code || row.ticket_id,
    course_ticket_id: Number(row.ticket_id),
    user_id: userId,
    action: row.action,
    record_type: 'course_ticket',
    meta: {
      method: row.method,
      ticket_type: row.product_name || '課程票券',
      transfer_id: Number(row.transfer_id),
      from_email: row.from_email || null,
      to_email: row.to_email || null,
    },
    created_at: row.created_at,
  };
}

function toProduct(row = {}) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    category: row.category || '',
    summary: row.summary || '',
    description: row.description || '',
    coverUrl: row.cover_url || '',
    hasCover: Boolean(row.cover_path),
    price: Number(row.price || 0),
    ticketProductId: row.ticket_product_id == null ? null : Number(row.ticket_product_id),
    components: Array.isArray(row.components) ? row.components : [],
    returningStudentOnly: Boolean(Number(row.returning_student_only || 0)),
    requireAddonForNew: Boolean(Number(row.require_addon_for_new || 0)),
    returningProductIds: Array.isArray(row.returningProductIds) ? row.returningProductIds : [],
    requiredAddonProductIds: Array.isArray(row.requiredAddonProductIds) ? row.requiredAddonProductIds : [],
    classCount: Number(row.class_count || 0),
    validDays: Number(row.valid_days || 0),
    activationDays: Number(row.activation_days || 0),
    transferable: Boolean(Number(row.transferable || 0)),
    externalPurchaseUrl: row.external_purchase_url || '',
    status: row.status || 'draft',
    sortOrder: Number(row.sort_order || 0),
    ...courseProviderFields(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version || 1),
  };
}

function buildCourseProductCoverStoragePath(productId, extension, storage) {
  const productFolder = String(positiveInt(productId, 0));
  const ext = String(extension || 'bin').replace(/^\.+/, '').replace(/[^a-z0-9]/gi, '') || 'bin';
  return path.posix.join(
    COURSE_PRODUCT_COVER_STORAGE_ROOT,
    productFolder,
    `${storage.generateStorageKey('cover')}.${ext}`
  );
}

async function ensureCourseProductCoverColumns(pool) {
  const [rows] = await pool.query('SHOW COLUMNS FROM course_products');
  const columns = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.Field || row.field || '')));
  const additions = [
    ['cover_type', 'ALTER TABLE course_products ADD COLUMN cover_type VARCHAR(100) NULL AFTER cover_url'],
    ['cover_path', 'ALTER TABLE course_products ADD COLUMN cover_path VARCHAR(512) NULL AFTER cover_type'],
  ];
  for (const [column, sql] of additions) {
    if (columns.has(column)) continue;
    try {
      await pool.query(sql);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

async function ensureCourseBookingVerificationSchema(pool) {
  const [rows] = await pool.query('SHOW COLUMNS FROM course_bookings');
  const columns = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.Field || row.field || '')));
  if (!columns.has('verify_code')) {
    try {
      await pool.query('ALTER TABLE course_bookings ADD COLUMN verify_code VARCHAR(40) NULL AFTER attendee_email');
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
  await pool.query(
    "UPDATE course_bookings SET verify_code = CONCAT('CBK-', UPPER(REPLACE(UUID(), '-', ''))) WHERE id > 0 AND (verify_code IS NULL OR verify_code = '')"
  );
  const [indexRows] = await pool.query('SHOW INDEX FROM course_bookings');
  const indexes = new Set((Array.isArray(indexRows) ? indexRows : []).map((row) => String(row.Key_name || row.key_name || '')));
  if (!indexes.has('uq_course_bookings_verify_code')) {
    try {
      await pool.query('ALTER TABLE course_bookings ADD UNIQUE KEY uq_course_bookings_verify_code (verify_code)');
    } catch (error) {
      if (error?.code !== 'ER_DUP_KEYNAME') throw error;
    }
  }
}

async function ensureCourseAttendanceLogConstraints(pool) {
  const [indexRows] = await pool.query('SHOW INDEX FROM course_attendance_logs');
  const indexes = new Set((Array.isArray(indexRows) ? indexRows : []).map((row) => String(row.Key_name || row.key_name || '')));
  if (indexes.has('uq_course_attendance_booking_action')) return;
  await pool.query(`
    DELETE duplicate_log
      FROM course_attendance_logs duplicate_log
      JOIN course_attendance_logs kept_log
        ON kept_log.booking_id = duplicate_log.booking_id
       AND kept_log.action = duplicate_log.action
       AND kept_log.id < duplicate_log.id
     WHERE duplicate_log.id > 0 AND duplicate_log.booking_id IS NOT NULL
  `);
  try {
    await pool.query(
      'ALTER TABLE course_attendance_logs ADD UNIQUE KEY uq_course_attendance_booking_action (booking_id, action)'
    );
  } catch (error) {
    if (error?.code !== 'ER_DUP_KEYNAME') throw error;
  }
}

async function ensureCourseTicketTransferWorkflowColumns(pool) {
  const [rows] = await pool.query('SHOW COLUMNS FROM course_ticket_transfers');
  const columns = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.Field || row.field || ''), row]));
  const additions = [
    ['code', 'ALTER TABLE course_ticket_transfers ADD COLUMN code VARCHAR(32) NULL AFTER to_email'],
    ['status', "ALTER TABLE course_ticket_transfers ADD COLUMN status ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted' AFTER code"],
    ['updated_at', 'ALTER TABLE course_ticket_transfers ADD COLUMN updated_at DATETIME NULL AFTER created_at'],
  ];
  for (const [column, sql] of additions) {
    if (columns.has(column)) continue;
    try {
      await pool.query(sql);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  const [currentRows] = await pool.query('SHOW COLUMNS FROM course_ticket_transfers');
  const currentColumns = new Map((Array.isArray(currentRows) ? currentRows : []).map((row) => [String(row.Field || row.field || ''), row]));
  if (String(currentColumns.get('to_user_id')?.Null || '').toUpperCase() !== 'YES') {
    await pool.query('ALTER TABLE course_ticket_transfers MODIFY COLUMN to_user_id CHAR(36) NULL');
  }
  if (String(currentColumns.get('to_email')?.Null || '').toUpperCase() !== 'YES') {
    await pool.query('ALTER TABLE course_ticket_transfers MODIFY COLUMN to_email VARCHAR(255) NULL');
  }
  await pool.query("UPDATE course_ticket_transfers SET status = 'accepted' WHERE id > 0 AND status IS NULL");
  const statusColumn = currentColumns.get('status') || {};
  if (String(statusColumn.Null || '').toUpperCase() !== 'NO' || String(statusColumn.Default || '') !== 'accepted') {
    await pool.query("ALTER TABLE course_ticket_transfers MODIFY COLUMN status ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted'");
  }
  await pool.query('UPDATE course_ticket_transfers SET updated_at = COALESCE(updated_at, created_at) WHERE id > 0 AND updated_at IS NULL');
  const updatedAtColumn = currentColumns.get('updated_at') || {};
  if (String(updatedAtColumn.Null || '').toUpperCase() !== 'NO' || !String(updatedAtColumn.Extra || '').toLowerCase().includes('on update')) {
    await pool.query('ALTER TABLE course_ticket_transfers MODIFY COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  }

  const [indexRows] = await pool.query('SHOW INDEX FROM course_ticket_transfers');
  const indexes = new Set((Array.isArray(indexRows) ? indexRows : []).map((row) => String(row.Key_name || row.key_name || '')));
  const indexAdditions = [
    ['uq_course_ticket_transfers_code', 'ALTER TABLE course_ticket_transfers ADD UNIQUE KEY uq_course_ticket_transfers_code (code)'],
    ['idx_course_ticket_transfers_to_user', 'ALTER TABLE course_ticket_transfers ADD KEY idx_course_ticket_transfers_to_user (to_user_id)'],
    ['idx_course_ticket_transfers_to_email', 'ALTER TABLE course_ticket_transfers ADD KEY idx_course_ticket_transfers_to_email (to_email)'],
    ['idx_course_ticket_transfers_status', 'ALTER TABLE course_ticket_transfers ADD KEY idx_course_ticket_transfers_status (status)'],
  ];
  for (const [index, sql] of indexAdditions) {
    if (indexes.has(index)) continue;
    try {
      await pool.query(sql);
    } catch (error) {
      if (error?.code !== 'ER_DUP_KEYNAME') throw error;
    }
  }
}

async function ensureCourseTicketTransferLogsTable(pool, { backfill = true } = {}) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_ticket_transfer_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      transfer_id BIGINT UNSIGNED NOT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      ticket_code VARCHAR(40) DEFAULT NULL,
      user_id CHAR(36) NOT NULL,
      from_user_id CHAR(36) NOT NULL,
      to_user_id CHAR(36) DEFAULT NULL,
      action VARCHAR(32) NOT NULL,
      method VARCHAR(16) NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      from_email VARCHAR(255) DEFAULT NULL,
      to_email VARCHAR(255) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_transfer_log_event (transfer_id, user_id, action),
      KEY idx_course_transfer_logs_user_created (user_id, created_at, id),
      KEY idx_course_transfer_logs_ticket (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (backfill) await backfillCourseTicketTransferLogs(pool);
}

async function ensureCourseTicketTransferWorkflowSchema(pool, { backfill = false } = {}) {
  await ensureCourseTicketTransferWorkflowColumns(pool);
  await ensureCourseTicketTransferLogsTable(pool, { backfill });
}

async function backfillCourseTicketTransferLogs(pool) {
  await pool.query(`
    INSERT IGNORE INTO course_ticket_transfer_logs
      (transfer_id, ticket_id, ticket_code, user_id, from_user_id, to_user_id, action, method, product_name, from_email, to_email, created_at)
    SELECT tr.id, tr.ticket_id, t.code, tr.from_user_id, tr.from_user_id, tr.to_user_id,
           'transferred_out', IF(tr.code IS NULL, 'email', 'qr'), p.name,
           tr.from_email, tr.to_email, tr.created_at
      FROM course_ticket_transfers tr
      JOIN course_tickets t ON t.id = tr.ticket_id
      JOIN course_products p ON p.id = t.product_id
     WHERE tr.status = 'accepted'
    UNION ALL
    SELECT tr.id, tr.ticket_id, t.code, tr.to_user_id, tr.from_user_id, tr.to_user_id,
           'transferred_in', IF(tr.code IS NULL, 'email', 'qr'), p.name,
           tr.from_email, tr.to_email, tr.created_at
      FROM course_ticket_transfers tr
      JOIN course_tickets t ON t.id = tr.ticket_id
      JOIN course_products p ON p.id = t.product_id
     WHERE tr.status = 'accepted' AND tr.to_user_id IS NOT NULL
  `);
}

async function backfillCourseTicketTransferLogsForRelatedUser(pool, userId) {
  await pool.query(`
    INSERT IGNORE INTO course_ticket_transfer_logs
      (transfer_id, ticket_id, ticket_code, user_id, from_user_id, to_user_id, action, method, product_name, from_email, to_email, created_at)
    SELECT tr.id, tr.ticket_id, t.code, tr.from_user_id, tr.from_user_id, tr.to_user_id,
           'transferred_out', IF(tr.code IS NULL, 'email', 'qr'), p.name,
           tr.from_email, tr.to_email, tr.created_at
      FROM course_ticket_transfers tr
      JOIN course_tickets t ON t.id = tr.ticket_id
      JOIN course_products p ON p.id = t.product_id
      LEFT JOIN course_ticket_transfer_logs l
        ON l.transfer_id = tr.id AND l.user_id = tr.from_user_id AND l.action = 'transferred_out'
     WHERE tr.status = 'accepted'
       AND (tr.from_user_id = ? OR tr.to_user_id = ?)
       AND l.id IS NULL
    UNION ALL
    SELECT tr.id, tr.ticket_id, t.code, tr.to_user_id, tr.from_user_id, tr.to_user_id,
           'transferred_in', IF(tr.code IS NULL, 'email', 'qr'), p.name,
           tr.from_email, tr.to_email, tr.created_at
      FROM course_ticket_transfers tr
      JOIN course_tickets t ON t.id = tr.ticket_id
      JOIN course_products p ON p.id = t.product_id
      LEFT JOIN course_ticket_transfer_logs l
        ON l.transfer_id = tr.id AND l.user_id = tr.to_user_id AND l.action = 'transferred_in'
     WHERE tr.status = 'accepted'
       AND tr.to_user_id IS NOT NULL
       AND (tr.from_user_id = ? OR tr.to_user_id = ?)
       AND l.id IS NULL
  `, [userId, userId, userId, userId]);
}

function toSession(row = {}) {
  const capacity = Number(row.capacity || 0);
  const bookedCount = Number(row.booked_count || 0);
  const remainingCapacity = capacity > 0 ? Math.max(0, capacity - bookedCount) : null;
  const now = Date.now();
  const startsAt = courseDateTimeMillis(row.starts_at);
  const endsAt = courseDateTimeMillis(row.ends_at);
  const opensAt = courseDateTimeMillis(row.booking_open_at);
  const closesAt = courseDateTimeMillis(row.booking_close_at);
  let bookingState = 'open';
  if (String(row.status || '').toLowerCase() === 'cancelled') bookingState = 'cancelled';
  else if (String(row.status || '').toLowerCase() !== 'open'
    || (Number.isFinite(endsAt) && endsAt < now)
    || (Number.isFinite(closesAt) && closesAt < now)) bookingState = 'closed';
  else if (Number.isFinite(opensAt) && opensAt > now) bookingState = 'not_open';
  else if (capacity > 0 && bookedCount >= capacity) bookingState = 'full';
  return {
    id: Number(row.id),
    code: row.code,
    productId: row.product_id == null ? null : Number(row.product_id),
    productName: row.product_name || '',
    scenarioId: row.scenario_id == null ? null : Number(row.scenario_id),
    scenarioName: row.scenario_name || '',
    coachProfileId: row.coach_profile_id == null ? null : Number(row.coach_profile_id),
    title: row.title,
    coachUserId: row.coach_user_id || null,
    coachName: row.coach_name || '',
    location: row.location || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    bookingOpenAt: row.booking_open_at,
    bookingCloseAt: row.booking_close_at,
    bookingOpenMinutesBefore: row.booking_open_minutes_before == null ? null : Number(row.booking_open_minutes_before),
    bookingCloseMinutesBefore: row.booking_close_minutes_before == null ? null : Number(row.booking_close_minutes_before),
    cancelCloseMinutesBefore: row.cancel_close_minutes_before == null ? null : Number(row.cancel_close_minutes_before),
    redeemOpenAt: row.redeem_open_at || null,
    redeemCloseAt: row.redeem_close_at || null,
    redeemOpenMinutesBefore: row.redeem_open_minutes_before == null ? null : Number(row.redeem_open_minutes_before),
    redeemCloseMinutesAfter: row.redeem_close_minutes_after == null ? null : Number(row.redeem_close_minutes_after),
    settingsSnapshot: safeJsonObject(row.settings_snapshot_json),
    capacity,
    bookedCount,
    remainingCapacity,
    bookingState,
    notes: row.notes || '',
    status: row.status || 'draft',
    ...courseProviderFields(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version || 1),
  };
}

function toTicket(row = {}) {
  const remaining = Number(row.remaining_uses_cache ?? row.remaining_uses ?? 0);
  const heldUses = Number(row.active_holds || row.held_uses || 0);
  let status = row.status || 'pending';
  if (status === 'active' && remaining <= 0) status = 'exhausted';
  if (
    status === 'active'
    && courseCalendarDate(row.expires_at)
    && courseCalendarDate(row.expires_at) < courseCalendarDate(Date.now())
  ) status = 'expired';
  return {
    id: Number(row.id),
    code: row.code,
    userId: row.user_id || null,
    ownerName: row.owner_name || row.username || '',
    ownerEmail: row.owner_email || row.email || '',
    productId: row.product_id == null ? null : Number(row.product_id),
    productName: row.product_name || '',
    ticketProductId: row.ticket_product_id == null ? null : Number(row.ticket_product_id),
    productCodeSnapshot: row.product_code_snapshot || '',
    productNameSnapshot: row.product_name_snapshot || row.product_name || '',
    orderId: row.order_id == null ? null : Number(row.order_id),
    totalUses: Number(row.total_uses || 0),
    remainingUses: remaining,
    heldUses,
    availableUses: Math.max(0, remaining - heldUses),
    status,
    issuedAt: row.issued_at,
    activationDeadline: row.activation_deadline,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    pausedAt: row.paused_at,
    pauseReason: row.pause_reason || '',
    transferable: Boolean(Number(row.transferable || 0)),
    ...courseProviderFields(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version || 1),
  };
}

function toCourseTicketRedemptionBooking(row = {}) {
  return {
    id: Number(row.id),
    sessionId: Number(row.session_id),
    sessionCode: row.session_code,
    sessionTitle: row.session_title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location || '',
    verifyCode: normalizeCourseBookingVerificationCode(row.verify_code),
    status: row.status,
  };
}

function attachCourseTicketRedemptionBookings(ticketRows = [], bookingRows = []) {
  const ticketIds = new Set(
    ticketRows
      .map((row) => Number(row.id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const bookingsByTicket = new Map();
  for (const row of bookingRows) {
    const ticketId = Number(row.ticket_id);
    if (!ticketIds.has(ticketId)
      || String(row.status || '').toLowerCase() !== 'booked'
      || !isCourseBookingVerificationCode(row.verify_code)) continue;
    const bookings = bookingsByTicket.get(ticketId) || [];
    bookings.push(toCourseTicketRedemptionBooking(row));
    bookingsByTicket.set(ticketId, bookings);
  }
  return ticketRows.map((row) => ({
    ...toTicket(row),
    redemptionBookings: bookingsByTicket.get(Number(row.id)) || [],
  }));
}

async function ensureCourseMultiTenantColumns(pool) {
  const ensureColumn = async (table, column, sql) => {
    const [rows] = await pool.query(`SHOW COLUMNS FROM ${table}`);
    const columns = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.Field || row.field || '')));
    if (columns.has(column)) return;
    try {
      await pool.query(sql);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  };
  await ensureColumn(
    'course_products',
    'owner_user_id',
    'ALTER TABLE course_products ADD COLUMN owner_user_id CHAR(36) NULL AFTER id'
  );
  await ensureColumn(
    'course_sessions',
    'owner_user_id',
    'ALTER TABLE course_sessions ADD COLUMN owner_user_id CHAR(36) NULL AFTER id'
  );
  await ensureColumn(
    'course_orders',
    'buyer_phone',
    'ALTER TABLE course_orders ADD COLUMN buyer_phone VARCHAR(20) NULL AFTER buyer_email'
  );
  const ensureIndex = async (table, name, sql) => {
    const [rows] = await pool.query(`SHOW INDEX FROM ${table}`);
    const indexes = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.Key_name || row.key_name || '')));
    if (indexes.has(name)) return;
    try { await pool.query(sql); } catch (error) {
      if (error?.code !== 'ER_DUP_KEYNAME') throw error;
    }
  };
  await ensureIndex(
    'course_products',
    'idx_course_products_owner_status_sort',
    'ALTER TABLE course_products ADD KEY idx_course_products_owner_status_sort (owner_user_id, status, sort_order, id)'
  );
  await ensureIndex(
    'course_sessions',
    'idx_course_sessions_owner_status_time',
    'ALTER TABLE course_sessions ADD KEY idx_course_sessions_owner_status_time (owner_user_id, status, starts_at, id)'
  );
  const ensureForeignKey = async (table, name, sql) => {
    const [rows] = await pool.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY' AND CONSTRAINT_NAME = ?`,
      [table, name]
    );
    if (rows.length) return;
    try { await pool.query(sql); } catch (error) {
      if (error?.code !== 'ER_DUP_KEYNAME' && error?.code !== 'ER_FK_DUP_NAME') throw error;
    }
  };
  await ensureForeignKey(
    'course_products',
    'fk_course_products_owner_user',
    'ALTER TABLE course_products ADD CONSTRAINT fk_course_products_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE'
  );
  await ensureForeignKey(
    'course_sessions',
    'fk_course_sessions_owner_user',
    'ALTER TABLE course_sessions ADD CONSTRAINT fk_course_sessions_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE'
  );
}

async function ensureCourseTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_products (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      owner_user_id CHAR(36) DEFAULT NULL,
      code VARCHAR(40) NOT NULL,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(80) DEFAULT NULL,
      summary VARCHAR(500) DEFAULT NULL,
      description MEDIUMTEXT DEFAULT NULL,
      cover_url VARCHAR(1000) DEFAULT NULL,
      cover_type VARCHAR(100) DEFAULT NULL,
      cover_path VARCHAR(512) DEFAULT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      class_count INT UNSIGNED NOT NULL DEFAULT 1,
      valid_days INT UNSIGNED NOT NULL DEFAULT 120,
      activation_days INT UNSIGNED NOT NULL DEFAULT 120,
      transferable TINYINT(1) NOT NULL DEFAULT 0,
      external_purchase_url VARCHAR(1000) DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_products_code (code),
      KEY idx_course_products_status_sort (status, sort_order, id),
      KEY idx_course_products_owner_status_sort (owner_user_id, status, sort_order, id),
      CONSTRAINT fk_course_products_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureCourseProductCoverColumns(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      owner_user_id CHAR(36) DEFAULT NULL,
      code VARCHAR(40) NOT NULL,
      product_id INT UNSIGNED DEFAULT NULL,
      title VARCHAR(255) NOT NULL,
      coach_user_id CHAR(36) DEFAULT NULL,
      coach_name VARCHAR(255) DEFAULT NULL,
      location VARCHAR(255) DEFAULT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      booking_open_at DATETIME DEFAULT NULL,
      booking_close_at DATETIME DEFAULT NULL,
      capacity INT UNSIGNED NOT NULL DEFAULT 20,
      notes TEXT DEFAULT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_sessions_code (code),
      KEY idx_course_sessions_time_status (starts_at, status),
      KEY idx_course_sessions_product (product_id),
      KEY idx_course_sessions_coach (coach_user_id),
      KEY idx_course_sessions_owner_status_time (owner_user_id, status, starts_at, id),
      CONSTRAINT fk_course_sessions_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE SET NULL,
      CONSTRAINT fk_course_sessions_coach FOREIGN KEY (coach_user_id) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_course_sessions_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      user_id CHAR(36) NOT NULL,
      buyer_name VARCHAR(255) NOT NULL,
      buyer_email VARCHAR(255) NOT NULL,
      buyer_phone VARCHAR(20) DEFAULT NULL,
      product_id INT UNSIGNED NOT NULL,
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      unit_price DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      remittance_last5 CHAR(5) DEFAULT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      terms_accepted_at DATETIME NOT NULL,
      note TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_orders_code (code),
      KEY idx_course_orders_user_created (user_id, created_at),
      KEY idx_course_orders_status_created (status, created_at),
      KEY idx_course_orders_product (product_id),
      CONSTRAINT fk_course_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_orders_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code VARCHAR(40) NOT NULL,
      user_id CHAR(36) NOT NULL,
      owner_name VARCHAR(255) DEFAULT NULL,
      owner_email VARCHAR(255) NOT NULL,
      product_id INT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED DEFAULT NULL,
      total_uses INT UNSIGNED NOT NULL DEFAULT 1,
      remaining_uses INT UNSIGNED NOT NULL DEFAULT 1,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',
      issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activation_deadline DATE DEFAULT NULL,
      activated_at DATETIME DEFAULT NULL,
      expires_at DATE DEFAULT NULL,
      paused_at DATETIME DEFAULT NULL,
      pause_reason VARCHAR(500) DEFAULT NULL,
      transferable TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_tickets_code (code),
      KEY idx_course_tickets_user_status (user_id, status),
      KEY idx_course_tickets_product (product_id),
      KEY idx_course_tickets_order (order_id),
      CONSTRAINT fk_course_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_tickets_product FOREIGN KEY (product_id) REFERENCES course_products(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_tickets_order FOREIGN KEY (order_id) REFERENCES course_orders(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_bookings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id CHAR(36) NOT NULL,
      attendee_name VARCHAR(255) NOT NULL,
      attendee_email VARCHAR(255) NOT NULL,
      verify_code VARCHAR(40) DEFAULT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'booked',
      booked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      cancelled_at DATETIME DEFAULT NULL,
      attended_at DATETIME DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_booking_session_user (session_id, user_id),
      UNIQUE KEY uq_course_bookings_verify_code (verify_code),
      KEY idx_course_bookings_user_created (user_id, created_at),
      KEY idx_course_bookings_session_status (session_id, status),
      KEY idx_course_bookings_ticket (ticket_id),
      CONSTRAINT fk_course_bookings_session FOREIGN KEY (session_id) REFERENCES course_sessions(id) ON DELETE CASCADE,
      CONSTRAINT fk_course_bookings_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureCourseBookingVerificationSchema(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_attendance_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      session_id BIGINT UNSIGNED NOT NULL,
      booking_id BIGINT UNSIGNED DEFAULT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id CHAR(36) NOT NULL,
      action VARCHAR(24) NOT NULL DEFAULT 'redeem',
      quantity INT UNSIGNED NOT NULL DEFAULT 1,
      staff_user_id CHAR(36) NOT NULL,
      note VARCHAR(500) DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_attendance_booking_action (booking_id, action),
      KEY idx_course_attendance_session (session_id, created_at),
      KEY idx_course_attendance_ticket (ticket_id, created_at),
      CONSTRAINT fk_course_attendance_session FOREIGN KEY (session_id) REFERENCES course_sessions(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_booking FOREIGN KEY (booking_id) REFERENCES course_bookings(id) ON DELETE SET NULL,
      CONSTRAINT fk_course_attendance_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_attendance_staff FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureCourseAttendanceLogConstraints(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_ticket_transfers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      ticket_id BIGINT UNSIGNED NOT NULL,
      from_user_id CHAR(36) NOT NULL,
      to_user_id CHAR(36) DEFAULT NULL,
      from_email VARCHAR(255) NOT NULL,
      to_email VARCHAR(255) DEFAULT NULL,
      code VARCHAR(32) DEFAULT NULL,
      status ENUM('pending','accepted','declined','canceled','expired') NOT NULL DEFAULT 'accepted',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_ticket_transfers_code (code),
      KEY idx_course_ticket_transfers_ticket (ticket_id, created_at),
      KEY idx_course_ticket_transfers_users (from_user_id, to_user_id),
      KEY idx_course_ticket_transfers_to_user (to_user_id),
      KEY idx_course_ticket_transfers_to_email (to_email),
      KEY idx_course_ticket_transfers_status (status),
      CONSTRAINT fk_course_ticket_transfers_ticket FOREIGN KEY (ticket_id) REFERENCES course_tickets(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_ticket_transfers_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE RESTRICT,
      CONSTRAINT fk_course_ticket_transfers_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS course_request_idempotency_keys (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id CHAR(36) NOT NULL,
      operation VARCHAR(32) NOT NULL,
      request_key VARCHAR(128) NOT NULL,
      request_hash CHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'processing',
      response_json JSON DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_course_request_user_operation_key (user_id, operation, request_key),
      KEY idx_course_request_operation_status_updated (operation, status, updated_at),
      KEY idx_course_request_created_at (created_at),
      CONSTRAINT fk_course_request_idempotency_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureCourseMultiTenantColumns(pool);
  await ensureCourseTicketTransferWorkflowColumns(pool);
  await ensureCourseTicketTransferLogsTable(pool);
}

function buildCourseRoutes(ctx) {
  const router = express.Router();
  const {
    ok,
    fail,
    pool,
    storage,
    authRequired,
    staffRequired,
    isMailerReady,
    transporter,
    EMAIL_FROM_NAME = 'Leader Online',
    EMAIL_FROM_ADDRESS = '',
    PUBLIC_WEB_URL = 'http://localhost:5173',
    courseBookingGoogleWalletSaveUrl = buildCourseBookingGoogleWalletSaveUrl,
  } = ctx;

  const courseV2 = createCourseV2Domain({ pool });

  // Freeze and cutover state lives in MySQL so every running main/v1 process
  // sees it. This guard deliberately sits before both legacy and V2 routes.
  router.use(async (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method || '').toUpperCase())) {
      return next();
    }
    try {
      await courseV2.assertMutationAllowed();
      return next();
    } catch (error) {
      if (error?.details && typeof res?.status === 'function' && typeof res?.json === 'function') {
        return res.status(Number(error.statusCode || 503)).json({
          ok: false,
          code: error.code || 'COURSE_WRITES_UNAVAILABLE',
          message: error.message || '課程寫入暫停',
          details: error.details,
        });
      }
      return fail(
        res,
        error?.code || 'COURSE_WRITES_UNAVAILABLE',
        error?.message || '課程寫入暫停',
        Number(error?.statusCode || 503)
      );
    }
  });

  registerCourseV2Routes({ router, ctx, domain: courseV2 });

  const courseManagerRequired = (req, res, next) => {
    if (courseV2.enabled) {
      return authRequired(req, res, async () => {
        const role = text(req.user?.role, 32).toUpperCase();
        if (role === 'ADMIN') return next();
        if (role === 'SERVICE_PROVIDER') {
          req.courseV2OwnerUserId = req.user.id;
          return next();
        }
        try {
          const requestedOwnerUserId = text(
            req.body?.ownerUserId
              ?? req.body?.owner_user_id
              ?? req.query?.ownerUserId
              ?? req.query?.owner_user_id
              ?? req.query?.providerUserId
              ?? req.query?.provider_user_id,
            36
          );
          const [rows] = await pool.query(
            `SELECT id, owner_user_id, role
               FROM course_staff_memberships
              WHERE user_id = ? AND status = 'active' AND role IN ('ops','coach')
                ${requestedOwnerUserId ? 'AND owner_user_id = ?' : ''}
              ORDER BY id
              LIMIT 2`,
            [req.user.id, ...(requestedOwnerUserId ? [requestedOwnerUserId] : [])]
          );
          if (rows.length !== 1) {
            return fail(
              res,
              rows.length ? 'COURSE_TENANT_REQUIRED' : 'FORBIDDEN',
              rows.length ? '此帳號屬於多個課程租戶，請明確指定 ownerUserId' : '需要課程租戶員工權限',
              403
            );
          }
          const membership = rows[0];
          req.courseV2OwnerUserId = membership.owner_user_id;
          req.courseV2Membership = membership;
          if (String(membership.role).toLowerCase() === 'coach') {
            const pathName = String(req.path || req.originalUrl || '');
            const isAttendanceRead = req.method === 'GET'
              && /^\/admin\/courses\/(?:sessions|bookings)(?:\/|$)/.test(pathName);
            const isAttendanceMutation = req.method === 'POST'
              && (
                pathName === '/admin/courses/bookings/progress_scan'
                || /^\/admin\/courses\/bookings\/[^/]+\/attend$/.test(pathName)
              );
            if (!isAttendanceRead && !isAttendanceMutation) {
              return fail(res, 'FORBIDDEN', '教練只能操作被指派場次的現場課務', 403);
            }
          }
          return next();
        } catch (error) {
          return fail(res, 'COURSE_STAFF_AUTH_FAIL', error.message || '課程權限檢查失敗', 500);
        }
      });
    }
    return staffRequired(req, res, () => {
    const role = normalizeCourseManagerRole(req.user?.role);
    if (role !== 'ADMIN' && role !== 'SERVICE_PROVIDER') {
      return fail(res, 'FORBIDDEN', '需要課程管理權限', 403);
    }
    return next();
    });
  };

  const isGlobalCourseManager = (user) => normalizeCourseManagerRole(user?.role) === 'ADMIN';

  // Course schema is migration-managed. Request handlers must not run DDL or
  // backfills; legacy queries fail normally when the baseline schema is
  // absent, while COURSE_V2_ENABLED has an explicit migration/cutover guard.
  const ensureSchema = async () => true;

  function pagingOptions(req, { defaultLimit = 50, maxLimit = 200 } = {}) {
    const paged = booleanFlag(req.query?.paged, false);
    const limit = Math.min(Math.max(positiveInt(req.query?.limit, defaultLimit), 1), maxLimit);
    const offset = nonNegativeInt(req.query?.offset ?? req.query?.skip, 0, Number.MAX_SAFE_INTEGER);
    const q = queryText(req.query?.q ?? req.query?.query, 255);
    const includeSummary = booleanFlag(req.query?.includeSummary ?? req.query?.include_summary, false);
    return { paged, limit, offset, q, includeSummary };
  }

  function pagedEnvelope(items, { total, limit, offset, q, summary = null }) {
    const data = {
      items,
      meta: {
        total: Number(total || 0),
        limit,
        offset,
        hasMore: offset + items.length < Number(total || 0),
        query: q || '',
      },
    };
    if (summary) data.summary = summary;
    return data;
  }

  async function assertCourseV2BookingActionScope(req, bookingId) {
    const [rows] = await pool.query(
      `SELECT b.id, b.session_id, s.owner_user_id, s.coach_user_id,
              cp.user_id AS coach_profile_user_id
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_coach_profiles cp ON cp.id = s.coach_profile_id
        WHERE b.id = ? LIMIT 1`,
      [positiveInt(bookingId)]
    );
    const scope = rows[0];
    if (!scope) throw Object.assign(new Error('找不到課程預約'), { code: 'COURSE_BOOKING_NOT_FOUND', statusCode: 404 });
    const role = text(req.user?.role, 32).toUpperCase();
    if (role === 'ADMIN') return scope;
    if (role === 'SERVICE_PROVIDER' && String(scope.owner_user_id) === String(req.user.id)) return scope;
    const [membershipRows] = await pool.query(
      `SELECT role FROM course_staff_memberships
        WHERE owner_user_id = ? AND user_id = ? AND status = 'active'
        LIMIT 1`,
      [scope.owner_user_id, req.user.id]
    );
    const membership = membershipRows[0];
    if (membership?.role === 'ops') return { ...scope, membershipRole: 'ops' };
    if (membership?.role === 'coach'
      && [scope.coach_user_id, scope.coach_profile_user_id].some((id) => String(id || '') === String(req.user.id))) {
      return { ...scope, membershipRole: 'coach' };
    }
    throw Object.assign(new Error('沒有此場次的出席操作權限'), { code: 'FORBIDDEN', statusCode: 403 });
  }

  async function assertCourseV2TenantOpsScope(req, ownerUserId) {
    const role = text(req.user?.role, 32).toUpperCase();
    if (role === 'ADMIN') return true;
    if (role === 'SERVICE_PROVIDER' && String(ownerUserId) === String(req.user.id)) return true;
    const [rows] = await pool.query(
      `SELECT id FROM course_staff_memberships
        WHERE owner_user_id = ? AND user_id = ? AND status = 'active' AND role = 'ops'
        LIMIT 1`,
      [ownerUserId, req.user.id]
    );
    if (rows.length) return true;
    throw Object.assign(new Error('沒有此課程租戶的管理權限'), { code: 'FORBIDDEN', statusCode: 403 });
  }

  async function loadCourseTicketRedemptionBookings(ticketRows, userId) {
    const ticketIds = [...new Set(
      ticketRows
        .map((row) => Number(row.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];
    if (!ticketIds.length) return [];
    const placeholders = ticketIds.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT b.id, b.ticket_id, b.session_id, b.verify_code, b.status,
              s.code AS session_code, s.title AS session_title,
              s.starts_at, s.ends_at, s.location
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         JOIN course_tickets t ON t.id = b.ticket_id
        WHERE b.ticket_id IN (${placeholders})
          AND b.user_id = ?
          AND t.user_id = ?
          AND b.status = 'booked'
          AND b.verify_code IS NOT NULL
          AND TRIM(b.verify_code) <> ''
          AND UPPER(TRIM(b.verify_code)) LIKE 'CBK-%'
        ORDER BY CASE WHEN s.ends_at >= NOW() THEN 0 ELSE 1 END,
                 CASE WHEN s.ends_at >= NOW() THEN s.starts_at END ASC,
                 CASE WHEN s.ends_at < NOW() THEN s.starts_at END DESC,
                 b.id DESC`,
      [...ticketIds, userId, userId]
    );
    return rows;
  }

  function appendManagerOwnerScope(req, alias, where, params, { allowAdminFilters = true } = {}) {
    if (!isGlobalCourseManager(req.user)) {
      where.push(`${alias}.owner_user_id = ?`);
      params.push(req.courseV2OwnerUserId || req.user.id);
      if (courseV2.enabled && req.courseV2Membership?.role === 'coach' && alias === 's') {
        where.push(`(
          ${alias}.coach_user_id = ?
          OR EXISTS (
            SELECT 1 FROM course_coach_profiles scoped_coach
             WHERE scoped_coach.id = ${alias}.coach_profile_id
               AND scoped_coach.user_id = ?
          )
        )`);
        params.push(req.user.id, req.user.id);
      }
      return;
    }
    if (!allowAdminFilters) return;
    const ownerType = queryText(req.query?.ownerType ?? req.query?.owner_type, 20).toLowerCase();
    const providerUserId = queryText(req.query?.providerUserId ?? req.query?.provider_user_id, 36);
    if (providerUserId) {
      where.push(`${alias}.owner_user_id = ?`);
      params.push(providerUserId);
    } else if (ownerType === 'platform') {
      where.push(`${alias}.owner_user_id IS NULL`);
    } else if (ownerType === 'provider') {
      where.push(`${alias}.owner_user_id IS NOT NULL`);
    }
  }

  function appendCourseTicketOwnerScope(req, where, params, { allowAdminFilters = true } = {}) {
    const ownerExpression = 'COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)';
    if (!isGlobalCourseManager(req.user)) {
      where.push(`${ownerExpression} = ?`);
      params.push(req.courseV2OwnerUserId || req.user.id);
      return;
    }
    if (!allowAdminFilters) return;
    const ownerType = queryText(req.query?.ownerType ?? req.query?.owner_type, 20).toLowerCase();
    const providerUserId = queryText(req.query?.providerUserId ?? req.query?.provider_user_id, 36);
    if (providerUserId) {
      where.push(`${ownerExpression} = ?`);
      params.push(providerUserId);
    } else if (ownerType === 'platform') {
      where.push(`${ownerExpression} IS NULL`);
    } else if (ownerType === 'provider') {
      where.push(`${ownerExpression} IS NOT NULL`);
    }
  }

  function appendCourseOrderOwnerScope(req, where, params, { allowAdminFilters = true } = {}) {
    const ownerExpression = 'COALESCE(p.owner_user_id, item_owner.owner_user_id, order_student.owner_user_id)';
    if (!isGlobalCourseManager(req.user)) {
      where.push(`${ownerExpression} = ?`);
      params.push(req.courseV2OwnerUserId || req.user.id);
      return;
    }
    if (!allowAdminFilters) return;
    const ownerType = queryText(req.query?.ownerType ?? req.query?.owner_type, 20).toLowerCase();
    const providerUserId = queryText(req.query?.providerUserId ?? req.query?.provider_user_id, 36);
    if (providerUserId) {
      where.push(`${ownerExpression} = ?`);
      params.push(providerUserId);
    } else if (ownerType === 'platform') {
      where.push(`${ownerExpression} IS NULL`);
    } else if (ownerType === 'provider') {
      where.push(`${ownerExpression} IS NOT NULL`);
    }
  }

  async function resolveCourseOwner(req, value, conn = pool, { fallback = null } = {}) {
    if (!isGlobalCourseManager(req.user)) return req.courseV2OwnerUserId || req.user.id;
    if (value === undefined) return fallback;
    const ownerUserId = text(value, 36) || null;
    if (!ownerUserId) return null;
    const [rows] = await conn.query(
      `SELECT id FROM users
        WHERE id = ? AND UPPER(COALESCE(role, '')) IN (
          ${courseV2.enabled ? "'SERVICE_PROVIDER'" : "'SERVICE_PROVIDER', 'STORE', 'COACH'"}
        )
        LIMIT 1`,
      [ownerUserId]
    );
    if (!rows.length) {
      const error = new Error('找不到可指派的服務商');
      error.code = 'COURSE_PROVIDER_NOT_FOUND';
      error.statusCode = 400;
      throw error;
    }
    return ownerUserId;
  }

  async function enrichCourseProductRelations(queryable, rows = []) {
    if (!courseV2.enabled || !rows.length) return rows;
    const productIds = rows.map((row) => positiveInt(row.id)).filter(Boolean);
    if (!productIds.length) return rows;
    const placeholders = productIds.map(() => '?').join(',');
    const [[componentRows], [returningRows], [addonRows]] = await Promise.all([
      queryable.query(
        `SELECT shop_product_id, ticket_product_id, component_role, quantity, sort_order
           FROM course_shop_product_components
          WHERE shop_product_id IN (${placeholders})
          ORDER BY shop_product_id, sort_order, id`,
        productIds
      ),
      queryable.query(
        `SELECT requirement.product_id, requirement.qualifying_ticket_product_id,
                (
                  SELECT MIN(candidate.id)
                    FROM course_products candidate
                    JOIN course_products owner_product ON owner_product.id = requirement.product_id
                   WHERE candidate.ticket_product_id = requirement.qualifying_ticket_product_id
                     AND candidate.owner_user_id <=> owner_product.owner_user_id
                ) AS qualifying_product_id
           FROM course_product_returning_requirements requirement
          WHERE requirement.product_id IN (${placeholders})
          ORDER BY requirement.product_id, requirement.qualifying_ticket_product_id`,
        productIds
      ),
      queryable.query(
        `SELECT product_id, addon_product_id, quantity, sort_order
           FROM course_product_required_addons
          WHERE product_id IN (${placeholders})
          ORDER BY product_id, sort_order, addon_product_id`,
        productIds
      ),
    ]);
    const components = new Map();
    const returningProductIds = new Map();
    const requiredAddonProductIds = new Map();
    for (const row of componentRows) {
      const key = Number(row.shop_product_id);
      if (!components.has(key)) components.set(key, []);
      components.get(key).push({
        ticketProductId: Number(row.ticket_product_id),
        role: row.component_role,
        quantity: Number(row.quantity || 1),
        sortOrder: Number(row.sort_order || 0),
      });
    }
    for (const row of returningRows) {
      const key = Number(row.product_id);
      if (!returningProductIds.has(key)) returningProductIds.set(key, []);
      const qualifyingId = Number(row.qualifying_product_id);
      if (qualifyingId) returningProductIds.get(key).push(qualifyingId);
    }
    for (const row of addonRows) {
      const key = Number(row.product_id);
      if (!requiredAddonProductIds.has(key)) requiredAddonProductIds.set(key, []);
      requiredAddonProductIds.get(key).push(Number(row.addon_product_id));
    }
    return rows.map((row) => ({
      ...row,
      components: components.get(Number(row.id)) || [],
      returningProductIds: returningProductIds.get(Number(row.id)) || [],
      requiredAddonProductIds: requiredAddonProductIds.get(Number(row.id)) || [],
    }));
  }

  function uniqueIds(values) {
    return Array.from(new Set((Array.isArray(values) ? values : [])
      .map((value) => positiveInt(value))
      .filter(Boolean)));
  }

  async function resolveCourseSalesPlanLinks(conn, {
    ownerUserId,
    body,
    productId = null,
  }) {
    const primaryTicketProductId = positiveInt(
      body?.ticketProductId ?? body?.ticket_product_id
    );
    if (!primaryTicketProductId) {
      throw Object.assign(new Error('銷售方案必須指定 TicketProduct'), {
        code: 'COURSE_TICKET_PRODUCT_REQUIRED',
        statusCode: 400,
      });
    }
    const componentInput = Array.isArray(body?.components)
      ? body.components
      : [{
        ticketProductId: primaryTicketProductId,
        role: 'primary',
        quantity: 1,
        sortOrder: 0,
      }];
    const componentMap = new Map();
    for (const [index, component] of componentInput.entries()) {
      const ticketProductId = positiveInt(
        component?.ticketProductId ?? component?.ticket_product_id
      );
      if (!ticketProductId) {
        throw Object.assign(new Error('銷售方案票券組成不正確'), {
          code: 'COURSE_SALES_PLAN_COMPONENT_INVALID',
          statusCode: 400,
        });
      }
      const role = text(component?.role ?? component?.componentRole ?? component?.component_role, 24)
        .toLowerCase() || 'included';
      const key = `${ticketProductId}:${role}`;
      componentMap.set(key, {
        ticketProductId,
        role,
        quantity: positiveInt(component?.quantity, 1, 999),
        sortOrder: Number.parseInt(component?.sortOrder ?? component?.sort_order, 10) || index,
      });
    }
    if (![...componentMap.values()].some((component) => (
      component.ticketProductId === primaryTicketProductId && component.role === 'primary'
    ))) {
      componentMap.set(`${primaryTicketProductId}:primary`, {
        ticketProductId: primaryTicketProductId,
        role: 'primary',
        quantity: 1,
        sortOrder: 0,
      });
    }
    const components = [...componentMap.values()];
    const ticketProductIds = Array.from(new Set(components.map((component) => component.ticketProductId)));
    const ticketPlaceholders = ticketProductIds.map(() => '?').join(',');
    const [ticketProductRows] = await conn.query(
      `SELECT * FROM course_ticket_products
        WHERE id IN (${ticketPlaceholders}) AND owner_user_id <=> ?
        ORDER BY id FOR UPDATE`,
      [...ticketProductIds, ownerUserId]
    );
    if (ticketProductRows.length !== ticketProductIds.length) {
      throw Object.assign(new Error('TicketProduct 不存在或不屬於目前服務商'), {
        code: 'COURSE_TICKET_PRODUCT_NOT_FOUND',
        statusCode: 404,
      });
    }
    const primaryTicketProduct = ticketProductRows.find(
      (row) => Number(row.id) === primaryTicketProductId
    );
    const returningProductIds = uniqueIds(
      body?.returningProductIds ?? body?.returning_product_ids
    ).filter((id) => Number(id) !== Number(productId));
    const requiredAddonProductIds = uniqueIds(
      body?.requiredAddonProductIds ?? body?.required_addon_product_ids
    ).filter((id) => Number(id) !== Number(productId));
    const linkedProductIds = Array.from(new Set([...returningProductIds, ...requiredAddonProductIds]));
    let linkedProducts = [];
    if (linkedProductIds.length) {
      const linkedPlaceholders = linkedProductIds.map(() => '?').join(',');
      [linkedProducts] = await conn.query(
        `SELECT id, ticket_product_id
           FROM course_products
          WHERE id IN (${linkedPlaceholders}) AND owner_user_id <=> ?
            AND status <> 'archived' AND ticket_product_id IS NOT NULL
          ORDER BY id FOR UPDATE`,
        [...linkedProductIds, ownerUserId]
      );
      if (linkedProducts.length !== linkedProductIds.length) {
        throw Object.assign(new Error('舊生條件或強制加購方案不存在，或不屬於目前服務商'), {
          code: 'COURSE_SALES_PLAN_RELATION_INVALID',
          statusCode: 409,
        });
      }
    }
    const linkedById = new Map(linkedProducts.map((row) => [Number(row.id), row]));
    return {
      primaryTicketProduct,
      components,
      returningTicketProductIds: returningProductIds.map(
        (id) => Number(linkedById.get(id).ticket_product_id)
      ),
      requiredAddonProductIds,
    };
  }

  async function replaceCourseSalesPlanLinks(conn, productId, links) {
    await conn.query('DELETE FROM course_shop_product_components WHERE shop_product_id = ?', [productId]);
    for (const component of links.components) {
      await conn.query(
        `INSERT INTO course_shop_product_components
          (shop_product_id, ticket_product_id, component_role, quantity, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [
          productId,
          component.ticketProductId,
          component.role,
          component.quantity,
          component.sortOrder,
        ]
      );
    }
    await conn.query('DELETE FROM course_product_returning_requirements WHERE product_id = ?', [productId]);
    for (const ticketProductId of links.returningTicketProductIds) {
      await conn.query(
        `INSERT INTO course_product_returning_requirements
          (product_id, qualifying_ticket_product_id)
         VALUES (?, ?)`,
        [productId, ticketProductId]
      );
    }
    await conn.query('DELETE FROM course_product_required_addons WHERE product_id = ?', [productId]);
    for (const [index, addonProductId] of links.requiredAddonProductIds.entries()) {
      await conn.query(
        `INSERT INTO course_product_required_addons
          (product_id, addon_product_id, quantity, sort_order)
         VALUES (?, ?, 1, ?)`,
        [productId, addonProductId, index]
      );
    }
  }

  function courseSettingsSnapshot(settings = {}) {
    return {
      booking_open_minutes_before: Number(
        settings.provider?.booking_open_minutes_before
          ?? settings.platform?.booking_open_minutes_before
          ?? 43200
      ),
      booking_close_minutes_before: Number(
        settings.provider?.booking_close_minutes_before
          ?? settings.platform?.booking_close_minutes_before
          ?? 0
      ),
      cancel_close_minutes_before: Number(
        settings.provider?.cancel_close_minutes_before
          ?? settings.platform?.cancel_close_minutes_before
          ?? 0
      ),
      redeem_open_minutes_before: Number(
        settings.provider?.redeem_open_minutes_before
          ?? settings.platform?.redeem_open_minutes_before
          ?? 120
      ),
      redeem_close_minutes_after: Number(
        settings.provider?.redeem_close_minutes_after
          ?? settings.platform?.redeem_close_minutes_after
          ?? 1440
      ),
      attendance_invite_expires_minutes: Number(
        settings.provider?.attendance_invite_expires_minutes
          ?? settings.platform?.attendance_invite_expires_minutes
          ?? 1440
      ),
      auto_no_show: Boolean(Number(
        settings.provider?.auto_no_show
          ?? settings.platform?.auto_no_show
          ?? 0
      )),
    };
  }

  async function resolveCourseSessionReferences(conn, {
    ownerUserId,
    scenarioId = null,
    coachProfileId = null,
  }) {
    let selectedScenarioId = positiveInt(scenarioId);
    if (selectedScenarioId) {
      const [scenarioRows] = await conn.query(
        `SELECT id FROM course_redeem_scenarios
          WHERE id = ? AND status = 'active'
            AND (owner_user_id <=> ? OR owner_user_id IS NULL)
          LIMIT 1 FOR UPDATE`,
        [selectedScenarioId, ownerUserId]
      );
      if (!scenarioRows[0]) {
        throw Object.assign(new Error('核銷情境不存在或不屬於目前服務商'), {
          code: 'COURSE_SCENARIO_NOT_FOUND',
          statusCode: 404,
        });
      }
    } else {
      const [scenarioRows] = await conn.query(
        `SELECT id FROM course_redeem_scenarios
          WHERE status = 'active' AND (owner_user_id <=> ? OR owner_user_id IS NULL)
          ORDER BY (owner_user_id <=> ?) DESC, id
          LIMIT 1 FOR UPDATE`,
        [ownerUserId, ownerUserId]
      );
      selectedScenarioId = positiveInt(scenarioRows[0]?.id);
    }
    if (!selectedScenarioId) {
      throw Object.assign(new Error('請先建立可用的核銷情境'), {
        code: 'COURSE_SCENARIO_REQUIRED',
        statusCode: 409,
      });
    }
    const selectedCoachProfileId = positiveInt(coachProfileId);
    let coachUserId = null;
    let coachName = null;
    if (selectedCoachProfileId) {
      const [coachRows] = await conn.query(
        `SELECT id, user_id, display_name FROM course_coach_profiles
          WHERE id = ? AND owner_user_id <=> ? AND status = 'active'
          LIMIT 1 FOR UPDATE`,
        [selectedCoachProfileId, ownerUserId]
      );
      if (!coachRows[0]) {
        throw Object.assign(new Error('教練名冊不存在或不屬於目前服務商'), {
          code: 'COURSE_COACH_PROFILE_NOT_FOUND',
          statusCode: 404,
        });
      }
      coachUserId = coachRows[0].user_id || null;
      coachName = coachRows[0].display_name || null;
    }
    return {
      scenarioId: selectedScenarioId,
      coachProfileId: selectedCoachProfileId,
      coachUserId,
      coachName,
    };
  }

  async function cancelCourseSessionReservations(conn, {
    sessionId,
    actorUserId,
    reason = 'session_cancelled',
  }) {
    const [bookingRows] = await conn.query(
      `SELECT id
         FROM course_bookings
        WHERE session_id = ? AND status = 'booked'
        ORDER BY id
        FOR UPDATE`,
      [sessionId]
    );
    for (const booking of bookingRows) {
      await courseV2.releaseHold(conn, {
        bookingId: booking.id,
        actorUserId,
        reason,
      });
    }
    if (bookingRows.length) {
      await conn.query(
        `UPDATE course_bookings
            SET status = 'cancelled', cancelled_at = NOW(), row_version = row_version + 1
          WHERE session_id = ? AND status = 'booked'`,
        [sessionId]
      );
    }

    const [inviteRows] = await conn.query(
      `SELECT id
         FROM course_attendance_invites
        WHERE session_id = ? AND status = 'pending'
        ORDER BY id
        FOR UPDATE`,
      [sessionId]
    );
    for (const invite of inviteRows) {
      await courseV2.releaseHold(conn, {
        inviteId: invite.id,
        actorUserId,
        reason,
      });
    }
    if (inviteRows.length) {
      await conn.query(
        `UPDATE course_attendance_invites
            SET status = 'cancelled', row_version = row_version + 1
          WHERE session_id = ? AND status = 'pending'`,
        [sessionId]
      );
    }
    return {
      cancelledBookings: bookingRows.length,
      cancelledInvites: inviteRows.length,
    };
  }

  async function findProduct(id, { publishedOnly = false, conn = pool, manager = null, forUpdate = false } = {}) {
    const productId = positiveInt(id);
    if (!productId) return null;
    const where = ['p.id = ?'];
    const params = [productId];
    if (publishedOnly) where.push("p.status = 'published'");
    if (manager && !isGlobalCourseManager(manager.user)) {
      where.push('p.owner_user_id = ?');
      params.push(manager.courseV2OwnerUserId || manager.user.id);
    }
    const [rows] = await conn.query(
      `SELECT p.*, provider.username AS provider_name
         FROM course_products p
         LEFT JOIN users provider ON provider.id = p.owner_user_id
        WHERE ${where.join(' AND ')}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      params
    );
    return rows[0] || null;
  }

  async function loadConfirmedCourseContact(req, conn, confirmation, { forUpdate = true } = {}) {
    const lock = forUpdate ? ' FOR UPDATE' : '';
    const [rows] = await conn.query(
      `SELECT username, email, phone, remittance_last5
         FROM users WHERE id = ? LIMIT 1${lock}`,
      [req.user.id]
    );
    const row = rows[0];
    if (!row) return { error: ['USER_NOT_FOUND', '找不到使用者', 404] };
    const current = {
      username: text(row.username, 255),
      email: normalizeCourseTransferEmail(row.email),
      phone: text(row.phone, 50),
      remittanceLast5: text(row.remittance_last5, 5),
    };
    const phoneDigits = current.phone.replace(/\D/g, '');
    if (!current.username) return { error: ['REAL_NAME_REQUIRED', '請先於帳戶中心填寫真實姓名', 400] };
    if (!current.email) return { error: ['EMAIL_REQUIRED', '請先於帳戶中心完成電子信箱', 400] };
    if (phoneDigits.length < 8) return { error: ['PHONE_REQUIRED', '請先於帳戶中心填寫手機號碼', 400] };
    if (!/^\d{5}$/.test(current.remittanceLast5)) return { error: ['REMITTANCE_LAST5_REQUIRED', '請先於帳戶中心填寫匯款帳號後五碼', 400] };
    if (!confirmation || typeof confirmation !== 'object' || Array.isArray(confirmation)) {
      return { error: ['COURSE_CONTACT_CONFIRMATION_REQUIRED', '請再次核對姓名、信箱、電話與匯款帳號後五碼', 400] };
    }
    if (!orderContactConfirmationMatches(current, confirmation)) {
      return { error: ['COURSE_CONTACT_CHANGED', '會員資料已變更，請重新核對後再送出', 409] };
    }
    return { current };
  }

  function buildCourseIdempotency(body, operation, payload) {
    const raw = body?.idempotencyKey ?? body?.idempotency_key;
    if (raw === undefined || raw === null || raw === '') return null;
    const requestKey = text(raw, 129);
    if (!requestKey || requestKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(requestKey)) {
      const error = new Error('提交識別碼格式不正確');
      error.code = 'IDEMPOTENCY_KEY_INVALID';
      error.statusCode = 400;
      throw error;
    }
    const requestHash = createHash('sha256').update(stableStringify(payload)).digest('hex');
    return { operation, requestKey, requestHash };
  }

  async function claimCourseIdempotency(conn, userId, context) {
    if (!context) return { claimed: false };
    const [insertResult] = await conn.query(
      `INSERT IGNORE INTO course_request_idempotency_keys
        (user_id, operation, request_key, request_hash, status)
       VALUES (?, ?, ?, ?, 'processing')`,
      [userId, context.operation, context.requestKey, context.requestHash]
    );
    if (Number(insertResult?.affectedRows || 0) === 1) return { claimed: true };
    const [rows] = await conn.query(
      `SELECT request_hash, status, response_json
         FROM course_request_idempotency_keys
        WHERE user_id = ? AND operation = ? AND request_key = ?
        LIMIT 1 FOR UPDATE`,
      [userId, context.operation, context.requestKey]
    );
    const row = rows[0];
    if (!row || String(row.request_hash || '') !== context.requestHash) {
      const error = new Error('此提交識別碼已被不同內容使用');
      error.code = 'IDEMPOTENCY_KEY_REUSED';
      error.statusCode = 409;
      throw error;
    }
    if (String(row.status) === 'completed') {
      try {
        const response = typeof row.response_json === 'string' ? JSON.parse(row.response_json) : row.response_json;
        if (response?.data) return { claimed: false, replay: response };
      } catch (_) {}
    }
    const error = new Error('請求仍在處理中，請稍後再試');
    error.code = 'IDEMPOTENCY_IN_PROGRESS';
    error.statusCode = 409;
    throw error;
  }

  async function completeCourseIdempotency(conn, userId, context, response) {
    if (!context) return;
    await conn.query(
      `UPDATE course_request_idempotency_keys
          SET status = 'completed', response_json = ?
        WHERE user_id = ? AND operation = ? AND request_key = ?`,
      [JSON.stringify(response), userId, context.operation, context.requestKey]
    );
  }

  async function serveCourseProductCover(res, product, { privateCache = false } = {}) {
    const coverPath = product?.cover_path ? storage.toSafeRelativePath(product.cover_path) : null;
    if (coverPath && await storage.fileExists(coverPath)) {
      const stat = await storage.getFileStat(coverPath);
      res.setHeader('Content-Type', product.cover_type || 'application/octet-stream');
      res.setHeader('Cache-Control', privateCache ? 'private, no-store' : 'public, max-age=86400');
      if (stat?.size) res.setHeader('Content-Length', stat.size);
      const stream = storage.createReadStream(coverPath);
      stream.on('error', (error) => {
        console.error('[courses] cover stream error:', error?.message || error);
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      stream.pipe(res);
      return true;
    }
    const externalCoverUrl = normalizeCourseCoverUrl(product?.cover_url);
    if (externalCoverUrl) {
      res.redirect(302, externalCoverUrl);
      return true;
    }
    return false;
  }

  async function uniqueCode(table, prefix, conn = pool) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = randomCode(prefix);
      const [rows] = await conn.query(`SELECT id FROM ${table} WHERE code = ? LIMIT 1`, [code]);
      if (!rows.length) return code;
    }
    throw new Error('代碼產生失敗，請再試一次');
  }

  function handleError(res, code, error) {
    console.error(`[courses] ${code}:`, error?.message || error);
    if (error?.code === 'ER_DUP_ENTRY') return fail(res, 'COURSE_DUPLICATE', '資料重複，請重新整理後再試', 409);
    if (['ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK'].includes(error?.code)) {
      return fail(res, 'IDEMPOTENCY_IN_PROGRESS', '請求仍在處理中，請稍後再試', 409);
    }
    const publicCode = error?.statusCode || error?.status ? (error.code || code) : code;
    return fail(res, publicCode, error?.message || '課程模塊處理失敗', error?.status || error?.statusCode || 500);
  }

  async function rollbackFail(conn, res, code, message, status) {
    try { await conn.rollback(); } catch (_) {}
    return fail(res, code, message, status);
  }

  const courseMailerReady = () => {
    if (typeof isMailerReady === 'function') return Boolean(isMailerReady());
    return Boolean(transporter && EMAIL_FROM_ADDRESS);
  };

  async function sendCourseNotificationEmail({ to, subject, html, text: plainText }) {
    const targetEmail = normalizeCourseTransferEmail(to);
    if (!targetEmail) return { mailed: false, reason: 'no_email' };
    if (!courseMailerReady() || !transporter?.sendMail) return { mailed: false, reason: 'mailer_not_ready' };
    const fromAddress = EMAIL_FROM_ADDRESS || undefined;
    try {
      await transporter.sendMail({
        from: fromAddress ? `${EMAIL_FROM_NAME} <${fromAddress}>` : EMAIL_FROM_NAME,
        to: targetEmail,
        subject,
        text: plainText,
        html,
      });
      return { mailed: true };
    } catch (error) {
      console.error('[courses] COURSE_EMAIL_SEND_FAIL:', error?.message || error);
      return { mailed: false, reason: error?.message || 'send_error' };
    }
  }

  async function sendCourseTicketTransferNotificationEmail({ targetEmail, senderName, ticket, recipientExists }) {
    const webBase = String(PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
    const actionUrl = recipientExists
      ? `${webBase}/wallet?tab=tickets&category=course`
      : `${webBase}/login?email=${encodeURIComponent(targetEmail)}&register=1`;
    const actionText = recipientExists ? '前往錢包查看轉讓' : '註冊並領取課程票券';
    const displaySender = text(senderName, 255) || '朋友';
    const productName = text(ticket?.product_name, 255) || '課程票券';
    const expiry = dateOnly(ticket?.expires_at);
    return sendCourseNotificationEmail({
      to: targetEmail,
      subject: '您收到一張課程票券轉讓 - Leader Online',
      text: `${displaySender} 轉讓了一張「${productName}」課程票券給您。${expiry ? `\n使用期限：${expiry}` : ''}\n${actionText}：${actionUrl}`,
      html: `
        <p>${escapeCourseEmailHtml(displaySender)} 轉讓了一張課程票券給您。</p>
        <p><strong>課程：</strong>${escapeCourseEmailHtml(productName)}</p>
        ${expiry ? `<p><strong>使用期限：</strong>${escapeCourseEmailHtml(expiry)}</p>` : ''}
        <p>請使用 ${escapeCourseEmailHtml(targetEmail)} 登入或註冊後處理這筆轉讓。</p>
        <p><a href="${escapeCourseEmailHtml(actionUrl)}">${escapeCourseEmailHtml(actionText)}</a></p>
        <p>若非您本人操作，可忽略此郵件。</p>
      `,
    });
  }

  async function expireOldCourseTicketTransfers(queryable = pool) {
    await queryable.query(
      `UPDATE course_ticket_transfers tr
         JOIN course_tickets t ON t.id = tr.ticket_id
          SET tr.status = 'expired'
        WHERE tr.status = 'pending'
          AND (
            (tr.code IS NOT NULL AND tr.created_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
            OR (tr.code IS NULL AND tr.created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
            OR (t.expires_at IS NOT NULL AND t.expires_at < CURRENT_DATE())
            OR (
              t.status = 'pending'
              AND t.activation_deadline IS NOT NULL
              AND t.activation_deadline < CURRENT_DATE()
            )
            OR COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) <= 0
            OR t.status NOT IN ('pending', 'active')
          )`
    );
  }

  async function expireLockedCourseTicketTransfer(conn, transfer) {
    if (!isCourseTicketTransferExpired(transfer)) return false;
    await conn.query(
      "UPDATE course_ticket_transfers SET status = 'expired' WHERE id = ? AND status = 'pending'",
      [transfer.id]
    );
    return true;
  }

  async function hasActiveCourseBooking(ticketId, queryable = pool) {
    const [rows] = await queryable.query(
      `SELECT id
         FROM course_ticket_holds
        WHERE ticket_id = ? AND status = 'active'
        LIMIT 1`,
      [ticketId]
    );
    return rows.length > 0;
  }

  async function courseTransferRecipientAddonBlockReason(conn, ticket, recipient) {
    if (!courseV2.enabled || !ticket?.product_id || !recipient?.id) return '';
    const [[product]] = await conn.query(
      `SELECT id, require_addon_for_new
         FROM course_products
        WHERE id = ?
        LIMIT 1`,
      [ticket.product_id]
    );
    if (!Number(product?.require_addon_for_new || 0)) return '';
    const returningEligible = await resolveReturningEligibility(conn, {
      productId: product.id,
      userId: recipient.id,
      forUpdate: true,
    });
    if (returningEligible) return '';

    const [requiredRows] = await conn.query(
      `SELECT requirement.addon_product_id,
              COALESCE(component.ticket_product_id, addon.ticket_product_id) AS ticket_product_id
         FROM course_product_required_addons requirement
         JOIN course_products addon ON addon.id = requirement.addon_product_id
         LEFT JOIN course_shop_product_components component
           ON component.shop_product_id = addon.id
        WHERE requirement.product_id = ?
        ORDER BY requirement.sort_order, requirement.addon_product_id, component.sort_order`,
      [product.id]
    );
    const requiredTicketProductIds = Array.from(new Set(
      requiredRows.map((row) => positiveInt(row.ticket_product_id)).filter(Boolean)
    ));
    if (!requiredTicketProductIds.length) return '';
    const [ownedRows] = await conn.query(
      `SELECT DISTINCT owned.ticket_product_id
         FROM course_tickets owned
         LEFT JOIN course_students owned_student ON owned_student.id = owned.student_id
        WHERE owned.ticket_product_id IN (${requiredTicketProductIds.map(() => '?').join(',')})
          AND (owned.user_id = ? OR owned_student.user_id = ?)
          AND owned.status <> 'void'
        FOR UPDATE`,
      [...requiredTicketProductIds, recipient.id, recipient.id]
    );
    const ownedIds = new Set(ownedRows.map((row) => Number(row.ticket_product_id)));
    if (requiredTicketProductIds.some((ticketProductId) => !ownedIds.has(ticketProductId))) {
      return '受讓人尚未具備此銷售方案要求的必要加購權益';
    }
    return '';
  }

  async function generateCourseTransferCode(queryable = pool) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = `CTK-${randomBytes(5).toString('hex').toUpperCase()}`;
      const [rows] = await queryable.query('SELECT id FROM course_ticket_transfers WHERE code = ? LIMIT 1', [code]);
      if (!rows.length) return code;
    }
    throw new Error('轉讓碼產生失敗，請再試一次');
  }

  async function generateCourseBookingVerificationCode(queryable = pool) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = randomCode('CBK-', 12);
      const [rows] = await queryable.query('SELECT id FROM course_bookings WHERE verify_code = ? LIMIT 1', [code]);
      if (!rows.length) return code;
    }
    throw new Error('課程核銷碼產生失敗，請再試一次');
  }

  async function initiateCourseTicketTransfer(req, res, { ticketId, mode, email } = {}) {
    const normalizedTicketId = positiveInt(ticketId);
    if (!normalizedTicketId || !['email', 'qr'].includes(mode)) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
    const targetEmail = mode === 'email' ? normalizeCourseTransferEmail(email) : '';
    if (mode === 'email' && !targetEmail) return fail(res, 'VALIDATION_ERROR', '需提供對方正確的 Email', 400);
    const idempotencyKey = courseV2.mutationKeyFromRequest(req);
    const expectedRowVersion = courseV2.rowVersionFromRequest(req);
    if (courseV2.enabled && !idempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '發起轉讓需要 Idempotency-Key', 400);
    }
    if (courseV2.enabled && !expectedRowVersion) {
      return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '發起轉讓需要票券 If-Match', 428);
    }

    const conn = await pool.getConnection();
    let notification = null;
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      let candidateTargetUserId = null;
      if (targetEmail) {
        const [targetRows] = await conn.query(
          'SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
          [targetEmail]
        );
        candidateTargetUserId = targetRows[0]?.id || null;
      }
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const userIdsToLock = Array.from(new Set(
        [req.user.id, candidateTargetUserId].map((value) => String(value || '').trim()).filter(Boolean)
      )).sort();
      const [lockedUsers] = await conn.query(
        `SELECT id, username, email FROM users
          WHERE id IN (${userIdsToLock.map(() => '?').join(',')})
          ORDER BY id FOR UPDATE`,
        userIdsToLock
      );
      const sender = lockedUsers.find((user) => String(user.id) === String(req.user.id));
      if (!sender) return rollbackFail(conn, res, 'USER_NOT_FOUND', '找不到使用者', 404);
      const operation = 'ticket.transfer.initiate';
      const mutation = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: {
            ticketId: normalizedTicketId,
            mode,
            email: targetEmail || null,
            expectedRowVersion,
          },
          resourceType: 'ticket',
          resourceId: normalizedTicketId,
        })
        : null;
      if (mutation?.replay) {
        await conn.commit();
        return ok(
          res,
          mutation.replay,
          mode === 'qr' ? '請出示 QR 給對方掃描立即轉讓' : '已發起課程票券轉讓（等待對方接受）'
        );
      }
      const targetUser = candidateTargetUserId
        ? lockedUsers.find((user) => String(user.id) === String(candidateTargetUserId)
          && normalizeCourseTransferEmail(user.email) === targetEmail) || null
        : null;
      // Account merge/delete flows lock users before course transfers. Keep the
      // same global lock order here to avoid a user <-> transfer deadlock.
      await expireOldCourseTicketTransfers(conn);
      if (targetEmail && targetEmail === normalizeCourseTransferEmail(sender.email)) {
        return rollbackFail(conn, res, 'VALIDATION_ERROR', '不可轉讓給自己', 400);
      }
      const [ticketRows] = await conn.query(
        `SELECT t.*,
                COALESCE(t.product_name_snapshot, tp.name, p.name) AS product_name,
                COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) AS owner_user_id,
                (SELECT COUNT(*) FROM course_ticket_transfers accepted
                  WHERE accepted.ticket_id = t.id AND accepted.status = 'accepted') AS accepted_transfer_count
           FROM course_tickets t
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
          WHERE t.id = ?
          LIMIT 1 FOR UPDATE`,
        [normalizedTicketId]
      );
      const ticket = ticketRows[0];
      if (!ticket) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      if (String(ticket.user_id) !== String(req.user.id)) return rollbackFail(conn, res, 'FORBIDDEN', '僅限持有者轉讓', 403);
      if (courseV2.enabled && Number(ticket.row_version || 1) !== Number(expectedRowVersion)) {
        return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      const blockReason = courseTicketTransferBlockReason(ticket, {
        hasActiveBooking: await hasActiveCourseBooking(ticket.id, conn),
        acceptedTransferCount: ticket.accepted_transfer_count,
      });
      if (blockReason) return rollbackFail(conn, res, 'COURSE_TICKET_TRANSFER_FAIL', blockReason, 409);
      const [pendingRows] = await conn.query(
        "SELECT id FROM course_ticket_transfers WHERE ticket_id = ? AND status = 'pending' LIMIT 1",
        [ticket.id]
      );
      if (pendingRows.length) return rollbackFail(conn, res, 'TRANSFER_EXISTS', '已有待處理的轉讓', 409);

      let transferId = null;
      let code = null;
      if (mode === 'email') {
        const toUserId = targetUser?.id || null;
        if (String(toUserId || '') === String(sender.id)) {
          return rollbackFail(conn, res, 'VALIDATION_ERROR', '不可轉讓給自己', 400);
        }
        const [insert] = await conn.query(
          `INSERT INTO course_ticket_transfers
             (ticket_id, from_user_id, to_user_id, from_email, to_email, code, status)
           VALUES (?, ?, ?, ?, ?, NULL, 'pending')`,
          [ticket.id, sender.id, toUserId, sender.email || '', targetEmail]
        );
        transferId = Number(insert.insertId);
        notification = { targetEmail, senderName: sender.username || sender.email, ticket, recipientExists: Boolean(toUserId) };
      } else {
        code = await generateCourseTransferCode(conn);
        const [insert] = await conn.query(
          `INSERT INTO course_ticket_transfers
             (ticket_id, from_user_id, to_user_id, from_email, to_email, code, status)
           VALUES (?, ?, NULL, ?, NULL, ?, 'pending')`,
          [ticket.id, sender.id, sender.email || '', code]
        );
        transferId = Number(insert.insertId);
      }
      let rowVersion = Number(ticket.row_version || 1);
      if (courseV2.enabled) {
        const [ticketUpdate] = await conn.query(
          `UPDATE course_tickets
              SET row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [ticket.id, expectedRowVersion]
        );
        if (!ticketUpdate.affectedRows) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        rowVersion += 1;
      }

      const response = {
        transferId,
        ...(code ? { code } : {}),
        ...(courseV2.enabled ? { rowVersion } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'course_ticket_transfer',
          id: transferId,
        });
      }
      await conn.commit();
      if (notification) {
        try { await sendCourseTicketTransferNotificationEmail(notification); } catch (_) { /* mail failure does not cancel transfer */ }
      }
      return ok(
        res,
        response,
        mode === 'qr' ? '請出示 QR 給對方掃描立即轉讓' : '已發起課程票券轉讓（等待對方接受）'
      );
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_INITIATE_FAIL', error);
    } finally {
      conn.release();
    }
  }

  async function recordCourseTicketTransferLogs(conn, transfer, ticket, recipient) {
    const method = transfer.code ? 'qr' : 'email';
    const fromEmail = transfer.from_email || '';
    const toEmail = transfer.to_email || recipient.email || null;
    await conn.query(
      `INSERT INTO course_ticket_transfer_logs
         (transfer_id, ticket_id, ticket_code, user_id, from_user_id, to_user_id, action, method, product_name, from_email, to_email)
       VALUES
         (?, ?, ?, ?, ?, ?, 'transferred_out', ?, ?, ?, ?),
         (?, ?, ?, ?, ?, ?, 'transferred_in', ?, ?, ?, ?)`,
      [
        transfer.id, ticket.id, ticket.code || null, transfer.from_user_id, transfer.from_user_id, recipient.id,
        method, ticket.product_name || '課程票券', fromEmail || null, toEmail,
        transfer.id, ticket.id, ticket.code || null, recipient.id, transfer.from_user_id, recipient.id,
        method, ticket.product_name || '課程票券', fromEmail || null, toEmail,
      ]
    );
  }

  async function completeCourseTicketTransfer(conn, transfer, recipient, {
    expectedTicketRowVersion = null,
  } = {}) {
    const [ticketRows] = await conn.query(
      `SELECT t.*,
              COALESCE(t.product_name_snapshot, tp.name, p.name) AS product_name,
              COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) AS owner_user_id,
              (SELECT COUNT(*) FROM course_ticket_transfers accepted
                WHERE accepted.ticket_id = t.id AND accepted.status = 'accepted') AS accepted_transfer_count
         FROM course_tickets t
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_products p ON p.id = t.product_id
        WHERE t.id = ?
        LIMIT 1 FOR UPDATE`,
      [transfer.ticket_id]
    );
    const ticket = ticketRows[0];
    if (!ticket) return { error: ['COURSE_TICKET_NOT_FOUND', '課程票券不存在', 404] };
    if (String(ticket.user_id) !== String(transfer.from_user_id)) return { error: ['TRANSFER_INVALID', '票券持有者已變更', 409] };
    if (
      courseV2.enabled
      && Number(ticket.row_version || 1) !== Number(expectedTicketRowVersion)
    ) {
      return { error: ['COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409] };
    }
    const blockReason = courseTicketTransferBlockReason(ticket, {
      hasActiveBooking: await hasActiveCourseBooking(ticket.id, conn),
      acceptedTransferCount: ticket.accepted_transfer_count,
    });
    if (blockReason) return { error: ['COURSE_TICKET_TRANSFER_FAIL', blockReason, 409] };
    const recipientAddonBlockReason = await courseTransferRecipientAddonBlockReason(
      conn,
      ticket,
      recipient
    );
    if (recipientAddonBlockReason) {
      return { error: ['COURSE_TRANSFER_ADDON_REQUIRED', recipientAddonBlockReason, 409] };
    }
    const recipientStudent = courseV2.enabled
      ? await ensureCourseStudent(conn, {
        ownerUserId: ticket.owner_user_id,
        userId: recipient.id,
        email: recipient.email,
        displayName: recipient.username,
      })
      : null;
    const [result] = await conn.query(
      `UPDATE course_tickets
          SET user_id = ?, student_id = COALESCE(?, student_id),
              owner_name = ?, owner_email = ?${courseV2.enabled ? ', row_version = row_version + 1' : ''}
        WHERE id = ? AND user_id = ?${courseV2.enabled ? ' AND row_version = ?' : ''}`,
      [
        recipient.id,
        recipientStudent?.id || null,
        recipient.username || '',
        recipient.email || '',
        ticket.id,
        transfer.from_user_id,
        ...(courseV2.enabled ? [expectedTicketRowVersion] : []),
      ]
    );
    if (!result.affectedRows) return { error: ['TRANSFER_CONFLICT', '轉讓狀態已變更，請重新整理', 409] };
    await conn.query(
      `UPDATE course_ticket_transfers
          SET status = 'accepted', to_user_id = ?, to_email = COALESCE(to_email, ?)
        WHERE id = ? AND status = 'pending'`,
      [recipient.id, recipient.email || null, transfer.id]
    );
    await conn.query(
      "UPDATE course_ticket_transfers SET status = 'canceled' WHERE ticket_id = ? AND status = 'pending' AND id <> ?",
      [ticket.id, transfer.id]
    );
    await recordCourseTicketTransferLogs(conn, transfer, ticket, recipient);
    return {
      ticket,
      rowVersion: Number(ticket.row_version || 1) + (courseV2.enabled ? 1 : 0),
    };
  }

  function toCourseOrder(row = {}) {
    const ticketCodes = Array.isArray(row.ticket_codes)
      ? row.ticket_codes
      : String(row.ticket_codes || '').split(',').map((value) => value.trim()).filter(Boolean);
    return {
      id: Number(row.id),
      code: row.code,
      userId: row.user_id,
      username: row.username || '',
      buyerName: row.buyer_name,
      buyerEmail: row.buyer_email,
      buyerPhone: row.buyer_phone || '',
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name || '',
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      totalAmount: Number(row.total_amount || 0),
      remittanceLast5: row.remittance_last5 || '',
      status: row.status,
      note: row.note || '',
      issuedTicketCount: Number(row.issued_ticket_count || ticketCodes.length || 0),
      ticketCodes,
      items: Array.isArray(row.items) ? row.items : [],
      ...courseProviderFields(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      rowVersion: Number(row.row_version || 1),
    };
  }

  function toCourseOrderItem(row = {}) {
    return {
      id: Number(row.id),
      orderId: Number(row.order_id),
      shopProductId: row.shop_product_id == null ? null : Number(row.shop_product_id),
      ticketProductId: row.ticket_product_id == null ? null : Number(row.ticket_product_id),
      itemType: row.item_type || 'primary',
      code: row.item_code_snapshot || row.shop_product_code || row.ticket_product_code || '',
      name: row.item_name_snapshot || row.shop_product_name || row.ticket_product_name || '',
      quantity: Number(row.quantity || 0),
      unitPrice: Number(row.unit_price || 0),
      lineTotal: Number(row.line_total || 0),
      issuanceStatus: row.issuance_status || 'pending',
      metadata: safeJsonObject(row.metadata_json),
      rowVersion: Number(row.row_version || 1),
    };
  }

  async function attachCourseOrderItems(queryable, rows = []) {
    if (!courseV2.enabled || !rows.length) return rows;
    const orderIds = rows.map((row) => positiveInt(row.id)).filter(Boolean);
    if (!orderIds.length) return rows;
    const [itemRows] = await queryable.query(
      `SELECT oi.*, shop.code AS shop_product_code, shop.name AS shop_product_name,
              tp.code AS ticket_product_code, tp.name AS ticket_product_name
         FROM course_order_items oi
         LEFT JOIN course_products shop ON shop.id = oi.shop_product_id
         LEFT JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
        WHERE oi.order_id IN (${orderIds.map(() => '?').join(',')})
        ORDER BY oi.order_id, oi.id`,
      orderIds
    );
    const grouped = new Map();
    for (const item of itemRows) {
      const orderId = Number(item.order_id);
      if (!grouped.has(orderId)) grouped.set(orderId, []);
      grouped.get(orderId).push(toCourseOrderItem(item));
    }
    return rows.map((row) => ({
      ...row,
      items: grouped.get(Number(row.id)) || [],
    }));
  }

  async function enrichCourseBookingPolicies(rows = []) {
    if (!courseV2.enabled || !rows.length) return rows.map(toCourseBooking);
    return Promise.all(rows.map(async (row) => {
      const item = toCourseBooking(row);
      const { booking, policy, pendingReview } = await courseV2.getBookingPolicy(row.id);
      const today = courseCalendarDate(Date.now());
      const expiresAt = courseCalendarDate(booking.expires_at);
      const activationDeadline = courseCalendarDate(booking.activation_deadline);
      const ticketStatus = String(booking.ticket_status || '').toLowerCase();
      const ticketDateValid = (!expiresAt || expiresAt >= today)
        && (
          ticketStatus !== 'pending'
          || !activationDeadline
          || activationDeadline >= today
        );
      const hasTicket = Boolean(booking.ticket_id);
      const hasActiveHold = Number(booking.active_holds || 0) > 0;
      const ticketConsumable = hasTicket
        && hasActiveHold
        && ['open', 'closed', 'completed'].includes(
          String(booking.session_status || '').toLowerCase()
        )
        && ['pending', 'active'].includes(ticketStatus)
        && !booking.frozen_at
        && Number(booking.remaining_uses_cache ?? booking.remaining_uses ?? 0) > 0
        && ticketDateValid;
      const ticketRestorable = hasTicket
        && ['pending', 'active', 'exhausted'].includes(ticketStatus)
        && !booking.frozen_at
        && ticketDateValid;
      const booked = String(booking.status || '').toLowerCase() === 'booked';
      const redeemable = booked
        && ticketConsumable
        && Boolean(policy.canRedeemOnsite);
      return {
        ...item,
        remainingUses: Number(
          booking.remaining_uses_cache ?? booking.remaining_uses ?? item.remainingUses ?? 0
        ),
        heldUses: Number(booking.active_holds || 0),
        availableUses: Math.max(
          0,
          Number(booking.remaining_uses_cache ?? booking.remaining_uses ?? 0)
            - Number(booking.active_holds || 0)
        ),
        policy,
        pendingReview,
        redeemable,
        capabilities: {
          cancel: booked && Boolean(policy.canCancel),
          redeem: redeemable,
          attend: redeemable,
          undo: ['attended', 'no_show'].includes(
            String(booking.status || '').toLowerCase()
          ) && (!hasTicket || ticketRestorable) && Boolean(policy.canRedeemOnsite),
          excusedLeave: booked,
          noShow: booked
            && (hasTicket ? ticketConsumable : true)
            && Date.now() >= Number(policy.startsAt),
          makeupRedeem: booked
            && ticketConsumable
            && Date.now() > Number(policy.redeemCloseAt),
        },
      };
    }));
  }

  function toCourseBooking(row = {}) {
    const settingsSnapshot = typeof row.settings_snapshot_json === 'string'
      ? safeJsonObject(row.settings_snapshot_json)
      : (row.settings_snapshot_json || {});
    const redeemCloseMinutes = Number(
      row.redeem_close_minutes_after
      ?? settingsSnapshot.redeem_close_minutes_after
      ?? 1440
    );
    const redeemCloseAt = courseDateTimeMillis(row.redeem_close_at);
    const endsAtMs = courseDateTimeMillis(row.ends_at);
    const effectiveRedeemCloseAt = Number.isFinite(redeemCloseAt)
      ? redeemCloseAt
      : (Number.isFinite(endsAtMs) ? endsAtMs + redeemCloseMinutes * 60000 : NaN);
    const cancelMinutes = Number(
      row.cancel_close_minutes_before
      ?? settingsSnapshot.cancel_close_minutes_before
      ?? 0
    );
    const startsAtMs = courseDateTimeMillis(row.starts_at);
    const cancelCloseAt = Number.isFinite(startsAtMs)
      ? startsAtMs - cancelMinutes * 60000
      : NaN;
    return {
      id: Number(row.id),
      sessionId: Number(row.session_id),
      sessionCode: row.session_code,
      sessionTitle: row.session_title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      location: row.location || '',
      coachName: row.coach_name || '',
      ticketId: row.ticket_id == null ? null : Number(row.ticket_id),
      ticketCode: row.ticket_code,
      remainingUses: Number(row.remaining_uses || 0),
      heldUses: Number(row.active_holds || 0),
      availableUses: Math.max(
        0,
        Number(row.remaining_uses || 0) - Number(row.active_holds || 0)
      ),
      productId: row.product_id == null ? null : Number(row.product_id),
      productName: row.product_name || '',
      userId: row.user_id,
      attendeeName: row.attendee_name,
      attendeeEmail: row.attendee_email,
      verifyCode: row.verify_code || '',
      status: row.status,
      bookedAt: row.booked_at,
      cancelledAt: row.cancelled_at,
      attendedAt: row.attended_at,
      pendingReview: String(row.status) === 'booked'
        && Number.isFinite(effectiveRedeemCloseAt)
        && Date.now() > effectiveRedeemCloseAt,
      rowVersion: Number(row.row_version || 1),
      capabilities: {
        cancel: String(row.status) === 'booked'
          && Number.isFinite(cancelCloseAt)
          && Date.now() <= cancelCloseAt,
      },
      ...courseProviderFields(row),
    };
  }

  router.get('/courses/products', async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req, { defaultLimit: 10, maxLimit: 100 });
      const where = ["p.status = 'published'"];
      const params = [];
      if (paging.q) {
        where.push('(p.name LIKE ? OR p.code LIKE ? OR p.category LIKE ? OR provider.username LIKE ?)');
        params.push(...Array(4).fill(`%${paging.q}%`));
      }
      const category = queryText(req.query?.category, 80);
      if (category) { where.push('p.category = ?'); params.push(category); }
      const providerUserId = queryText(req.query?.providerUserId ?? req.query?.provider_user_id, 36);
      if (providerUserId) { where.push('p.owner_user_id = ?'); params.push(providerUserId); }
      const ownerType = queryText(req.query?.ownerType ?? req.query?.owner_type, 20).toLowerCase();
      if (!providerUserId && ownerType === 'platform') where.push('p.owner_user_id IS NULL');
      if (!providerUserId && ownerType === 'provider') where.push('p.owner_user_id IS NOT NULL');
      const priceMin = Number(firstValue(req.query?.priceMin ?? req.query?.price_min));
      const priceMax = Number(firstValue(req.query?.priceMax ?? req.query?.price_max));
      if (Number.isFinite(priceMin) && priceMin >= 0) { where.push('p.price >= ?'); params.push(priceMin); }
      if (Number.isFinite(priceMax) && priceMax >= 0) { where.push('p.price <= ?'); params.push(priceMax); }
      for (const [queryKey, column, operator] of [
        ['classCountMin', 'p.class_count', '>='], ['classCountMax', 'p.class_count', '<='],
        ['validDaysMin', 'p.valid_days', '>='], ['validDaysMax', 'p.valid_days', '<='],
        ['activationDaysMin', 'p.activation_days', '>='], ['activationDaysMax', 'p.activation_days', '<='],
      ]) {
        const value = nonNegativeInt(req.query?.[queryKey] ?? req.query?.[queryKey.replace(/[A-Z]/g, (part) => `_${part.toLowerCase()}`)], null);
        if (value !== null) { where.push(`${column} ${operator} ?`); params.push(value); }
      }
      const transferable = queryBoolean(req.query?.transferable);
      if (transferable !== null) { where.push('p.transferable = ?'); params.push(transferable ? 1 : 0); }
      const updatedFrom = queryDate(req.query?.updatedFrom ?? req.query?.updated_from);
      const updatedTo = queryDate(req.query?.updatedTo ?? req.query?.updated_to);
      if (updatedFrom) { where.push('p.updated_at >= ?'); params.push(`${updatedFrom} 00:00:00`); }
      if (updatedTo) { where.push('p.updated_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(updatedTo); }
      const sort = queryText(req.query?.sort, 32).toLowerCase();
      const orderBy = ['price_asc', 'priceasc'].includes(sort) ? 'p.price ASC, p.id DESC'
        : ['price_desc', 'pricedesc'].includes(sort) ? 'p.price DESC, p.id DESC'
          : sort === 'newest' ? 'p.created_at DESC, p.id DESC'
            : 'p.sort_order ASC, p.id DESC';
      const [rows] = await pool.query(
        `SELECT p.*, provider.username AS provider_name
           FROM course_products p
           LEFT JOIN users provider ON provider.id = p.owner_user_id
          WHERE ${where.join(' AND ')}
          ORDER BY ${orderBy}${paging.paged ? ' LIMIT ? OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : params
      );
      const items = rows.map(toProduct);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM course_products p
           LEFT JOIN users provider ON provider.id = p.owner_user_id
          WHERE ${where.join(' AND ')}`,
        params
      );
      let summary = null;
      if (paging.includeSummary) {
        const [[scopeCount], [categoryRows], [providerRows]] = await Promise.all([
          pool.query("SELECT COUNT(*) AS total FROM course_products WHERE status = 'published'"),
          pool.query("SELECT DISTINCT category FROM course_products WHERE status = 'published' AND category IS NOT NULL AND category <> '' ORDER BY category"),
          pool.query(`SELECT DISTINCT p.owner_user_id AS id, COALESCE(u.username, '') AS name
                        FROM course_products p LEFT JOIN users u ON u.id = p.owner_user_id
                       WHERE p.status = 'published' AND p.owner_user_id IS NOT NULL ORDER BY name, id`),
        ]);
        summary = {
          total: Number(scopeCount[0]?.total || 0),
          byStatus: { published: Number(scopeCount[0]?.total || 0) },
          categories: categoryRows.map((row) => row.category).filter(Boolean),
          providers: providerRows.map((row) => ({ id: row.id, name: row.name || '' })),
        };
      }
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'COURSE_PRODUCTS_LIST_FAIL', error);
    }
  });

  router.get('/courses/products/:id/cover', async (req, res) => {
    try {
      await ensureSchema();
      const product = await findProduct(req.params.id, { publishedOnly: true });
      if (!product) return res.status(404).end();
      if (await serveCourseProductCover(res, product)) return;
      return res.status(404).end();
    } catch (error) {
      console.error('[courses] COURSE_PRODUCT_COVER_READ_FAIL:', error?.message || error);
      return res.status(500).end();
    }
  });

  router.get('/courses/products/:id', async (req, res) => {
    try {
      await ensureSchema();
      const identifier = queryText(req.params.id, 40);
      const where = positiveInt(identifier) ? 'p.id = ?' : 'p.code = ?';
      const [rows] = await pool.query(
        `SELECT p.*, provider.username AS provider_name
           FROM course_products p LEFT JOIN users provider ON provider.id = p.owner_user_id
          WHERE ${where} AND p.status = 'published' LIMIT 1`,
        [positiveInt(identifier) || identifier.toUpperCase()]
      );
      if (!rows.length) return fail(res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可購買的課程商品', 404);
      return ok(res, toProduct(rows[0]));
    } catch (error) {
      return handleError(res, 'COURSE_PRODUCT_READ_FAIL', error);
    }
  });

  router.get('/courses/sessions', async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req, { defaultLimit: 10, maxLimit: 100 });
      const productId = positiveInt(req.query.productId ?? req.query.product_id);
      const params = [];
      const where = ["s.status = 'open'", 's.ends_at >= NOW()', "(s.product_id IS NULL OR p.status = 'published')"];
      if (productId) {
        where.push(`EXISTS (
          SELECT 1 FROM course_products selected_product
           WHERE selected_product.id = ? AND selected_product.status = 'published'
             AND (s.product_id = selected_product.id
               OR (s.product_id IS NULL AND s.owner_user_id <=> selected_product.owner_user_id))
        )`);
        params.push(productId);
      }
      if (paging.q) {
        where.push('(s.title LIKE ? OR s.code LIKE ? OR s.location LIKE ? OR p.name LIKE ? OR COALESCE(s.coach_name, coach.username, \'\') LIKE ? OR provider.username LIKE ?)');
        params.push(...Array(6).fill(`%${paging.q}%`));
      }
      const productQuery = queryText(req.query?.product, 255);
      const coachQuery = queryText(req.query?.coach, 255);
      const locationQuery = queryText(req.query?.location, 255);
      if (productQuery) { where.push('(p.name LIKE ? OR p.code LIKE ?)'); params.push(...Array(2).fill(`%${productQuery}%`)); }
      if (coachQuery) { where.push("COALESCE(s.coach_name, coach.username, '') LIKE ?"); params.push(`%${coachQuery}%`); }
      if (locationQuery) { where.push('s.location LIKE ?'); params.push(`%${locationQuery}%`); }
      const category = queryText(req.query?.category, 80);
      if (category) { where.push('p.category = ?'); params.push(category); }
      const providerUserId = queryText(req.query?.providerUserId ?? req.query?.provider_user_id, 36);
      if (providerUserId) { where.push('s.owner_user_id = ?'); params.push(providerUserId); }
      const ownerType = queryText(req.query?.ownerType ?? req.query?.owner_type, 20).toLowerCase();
      if (!providerUserId && ownerType === 'platform') where.push('s.owner_user_id IS NULL');
      if (!providerUserId && ownerType === 'provider') where.push('s.owner_user_id IS NOT NULL');
      const startsFrom = queryDate(req.query?.startsFrom ?? req.query?.starts_from);
      const startsTo = queryDate(req.query?.startsTo ?? req.query?.starts_to);
      if (startsFrom) { where.push('s.starts_at >= ?'); params.push(`${startsFrom} 00:00:00`); }
      if (startsTo) { where.push('s.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(startsTo); }
      const bookedCountSql = "(SELECT COUNT(*) FROM course_bookings bx WHERE bx.session_id = s.id AND bx.status IN ('booked', 'attended'))";
      if (queryText(req.query?.availability, 20).toLowerCase() === 'available') {
        where.push(`(s.capacity = 0 OR ${bookedCountSql} < s.capacity)`);
      }
      if (queryText(req.query?.availability, 20).toLowerCase() === 'full') {
        where.push(`(s.capacity > 0 AND ${bookedCountSql} >= s.capacity)`);
      }
      const sessionSort = queryText(req.query?.sort, 32).toLowerCase();
      const sessionOrderBy = ['starts_desc', 'startsdesc'].includes(sessionSort)
        ? 's.starts_at DESC, s.id DESC'
        : 's.starts_at ASC, s.id ASC';
      const [rows] = await pool.query(
        `SELECT s.*, p.name AS product_name,
                COALESCE(s.coach_name, coach.username, '') AS coach_name,
                provider.username AS provider_name,
                ${bookedCountSql} AS booked_count
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = s.owner_user_id
          WHERE ${where.join(' AND ')}
          ORDER BY ${sessionOrderBy}${paging.paged ? ' LIMIT ? OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : params
      );
      const items = rows.map(toSession);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = s.owner_user_id
          WHERE ${where.join(' AND ')}`,
        params
      );
      let summary = null;
      if (paging.includeSummary) {
        const [[scopeCount], [providerRows], [categoryRows]] = await Promise.all([
          pool.query(`SELECT COUNT(*) AS total
                        FROM course_sessions s LEFT JOIN course_products p ON p.id = s.product_id
                       WHERE s.status = 'open' AND s.ends_at >= NOW()
                         AND (s.product_id IS NULL OR p.status = 'published')`),
          pool.query(`SELECT DISTINCT s.owner_user_id AS id, COALESCE(u.username, '') AS name
                        FROM course_sessions s
                        LEFT JOIN course_products p ON p.id = s.product_id
                        LEFT JOIN users u ON u.id = s.owner_user_id
                       WHERE s.status = 'open' AND s.ends_at >= NOW()
                         AND (s.product_id IS NULL OR p.status = 'published')
                         AND s.owner_user_id IS NOT NULL ORDER BY name, id`),
          pool.query(`SELECT DISTINCT p.category
                        FROM course_sessions s JOIN course_products p ON p.id = s.product_id
                       WHERE s.status = 'open' AND s.ends_at >= NOW() AND p.status = 'published'
                         AND p.category IS NOT NULL AND p.category <> '' ORDER BY p.category`),
        ]);
        summary = {
          total: Number(scopeCount[0]?.total || 0),
          byStatus: { open: Number(scopeCount[0]?.total || 0) },
          providers: providerRows.map((row) => ({ id: row.id, name: row.name || '' })),
          categories: categoryRows.map((row) => row.category).filter(Boolean),
        };
      }
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'COURSE_SESSIONS_LIST_FAIL', error);
    }
  });

  router.get('/courses/sessions/:id', async (req, res) => {
    try {
      await ensureSchema();
      const identifier = queryText(req.params.id, 40);
      const where = positiveInt(identifier) ? 's.id = ?' : 's.code = ?';
      const [rows] = await pool.query(
        `SELECT s.*, p.name AS product_name, COALESCE(s.coach_name, coach.username, '') AS coach_name,
                provider.username AS provider_name,
                (SELECT COUNT(*) FROM course_bookings b WHERE b.session_id = s.id AND b.status IN ('booked','attended')) AS booked_count
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = s.owner_user_id
          WHERE ${where} AND s.status = 'open' AND s.ends_at >= NOW()
            AND (s.product_id IS NULL OR p.status = 'published') LIMIT 1`,
        [positiveInt(identifier) || identifier.toUpperCase()]
      );
      if (!rows.length) return fail(res, 'COURSE_SESSION_NOT_FOUND', '找不到可預約的課程場次', 404);
      return ok(res, toSession(rows[0]));
    } catch (error) {
      return handleError(res, 'COURSE_SESSION_READ_FAIL', error);
    }
  });

  router.post('/courses/orders', authRequired, async (req, res) => {
    let idempotency;
    const v2IdempotencyKey = courseV2.mutationKeyFromRequest(req);
    if (courseV2.enabled && !v2IdempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '建立訂單需要 Idempotency-Key', 400);
    }
    if (v2IdempotencyKey && !req.body?.idempotencyKey && !req.body?.idempotency_key) {
      req.body = { ...(req.body || {}), idempotencyKey: v2IdempotencyKey };
    }
    try {
      idempotency = buildCourseIdempotency(req.body || {}, 'order.create', {
        productId: positiveInt(req.body?.productId ?? req.body?.product_id),
        quantity: positiveInt(req.body?.quantity, 1, 10),
        expectedUnitPrice: money(req.body?.expectedUnitPrice ?? req.body?.expected_unit_price, null),
        expectedOwnerUserId: firstOwnField(req.body, [
          'expectedOwnerUserId', 'expected_owner_user_id', 'expectedProviderUserId', 'expected_provider_user_id',
        ]),
        contactConfirmation: normalizeOrderContact(
          req.body?.contactConfirmation ?? req.body?.contact_confirmation ?? {}
        ),
        legacyConfirmation: req.body?.userDataConfirmation ?? req.body?.user_data_confirmation ?? null,
        termsAccepted: booleanFlag(req.body?.termsAccepted ?? req.body?.terms_accepted, false),
        note: text(req.body?.note, 1000),
      });
    } catch (error) {
      return handleError(res, 'COURSE_ORDER_CREATE_FAIL', error);
    }
    const conn = await pool.getConnection();
    let notification = null;
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      if (courseV2.enabled) await courseV2.assertMutationAllowed(conn);
      let v2Mutation = null;
      const claim = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'order.create',
          idempotencyKey: v2IdempotencyKey,
          payload: {
            productId: positiveInt(req.body?.productId ?? req.body?.product_id),
            quantity: positiveInt(req.body?.quantity, 1, 10),
            expectedProductRowVersion: courseV2.rowVersionFromRequest(req),
            expectedTotalAmount: money(req.body?.expectedTotalAmount ?? req.body?.expected_total_amount, null),
          },
          resourceType: 'shop_product',
          resourceId: positiveInt(req.body?.productId ?? req.body?.product_id),
        })
        : await claimCourseIdempotency(conn, req.user.id, idempotency);
      if (courseV2.enabled) v2Mutation = claim;
      if (claim.replay) {
        await conn.commit();
        return courseV2.enabled
          ? ok(res, claim.replay, '課程訂單已建立')
          : ok(res, claim.replay.data, claim.replay.message);
      }
      const quantity = positiveInt(req.body?.quantity, 1, 10);
      let buyerName = text(req.body?.buyerName ?? req.body?.buyer_name ?? req.user?.username, 255);
      let buyerEmail = normalizeCourseTransferEmail(req.body?.buyerEmail ?? req.body?.buyer_email ?? req.user?.email);
      let buyerPhone = text(req.body?.buyerPhone ?? req.body?.buyer_phone, 50);
      let remittanceLast5 = text(req.body?.remittanceLast5 ?? req.body?.remittance_last5, 5);
      const contactConfirmation = req.body?.contactConfirmation ?? req.body?.contact_confirmation;
      if (idempotency && contactConfirmation === undefined) {
        return rollbackFail(conn, res, 'COURSE_CONTACT_CONFIRMATION_REQUIRED', '請再次核對姓名、信箱、電話與匯款帳號後五碼', 400);
      }
      if (contactConfirmation !== undefined) {
        const contact = await loadConfirmedCourseContact(req, conn, contactConfirmation);
        if (contact.error) return rollbackFail(conn, res, ...contact.error);
        buyerName = contact.current.username;
        buyerEmail = contact.current.email;
        buyerPhone = contact.current.phone;
        remittanceLast5 = contact.current.remittanceLast5;
      }
      if (!buyerName || !buyerEmail) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請填寫購買人姓名與正確 Email', 400);
      if (remittanceLast5 && !/^\d{5}$/.test(remittanceLast5)) return rollbackFail(conn, res, 'VALIDATION_ERROR', '匯款帳號後五碼需為 5 位數字', 400);
      if (!booleanFlag(req.body?.termsAccepted ?? req.body?.terms_accepted, false)) return rollbackFail(conn, res, 'COURSE_TERMS_REQUIRED', '請先閱讀並同意課程使用須知', 400);
      if (contactConfirmation === undefined) {
        const userDataConfirmation = req.body?.userDataConfirmation ?? req.body?.user_data_confirmation;
        if (!userDataConfirmation || typeof userDataConfirmation !== 'object' || Array.isArray(userDataConfirmation)) {
          return rollbackFail(conn, res, 'COURSE_USER_DATA_CONFIRMATION_REQUIRED', '請再次核對購買人資料後再建立訂單', 400);
        }
        if (!courseUserDataConfirmationMatches(userDataConfirmation, { buyerName, buyerEmail, remittanceLast5 })) {
          return rollbackFail(conn, res, 'COURSE_USER_DATA_CONFIRMATION_CHANGED', '購買人資料已變更，請重新核對後再下單', 409);
        }
      }
      const product = await findProduct(req.body?.productId ?? req.body?.product_id, {
        publishedOnly: true,
        conn,
        forUpdate: true,
      });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可購買的課程商品', 404);
      let v2OrderItems = [];
      if (courseV2.enabled) {
        const expectedProductRowVersion = courseV2.rowVersionFromRequest(req);
        if (!expectedProductRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '建立訂單需要銷售方案 If-Match', 428);
        }
        if (Number(product.row_version || 1) !== Number(expectedProductRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新確認', 409);
        }
        const returningEligible = await resolveReturningEligibility(conn, {
          productId: product.id,
          userId: req.user.id,
          forUpdate: true,
        });
        const includeRequiredAddons = shouldIncludeRequiredAddons(
          product.require_addon_for_new,
          returningEligible
        );
        const [componentRows] = await conn.query(
          `SELECT component.ticket_product_id, component.component_role,
                  component.quantity AS component_quantity,
                  tp.code, tp.name
             FROM course_shop_product_components component
             JOIN course_ticket_products tp ON tp.id = component.ticket_product_id
            WHERE component.shop_product_id = ?
            ORDER BY component.sort_order, component.ticket_product_id
            FOR UPDATE`,
          [product.id]
        );
        const primaryComponents = componentRows.length
          ? componentRows
          : [{
            ticket_product_id: product.ticket_product_id,
            component_role: 'primary',
            component_quantity: 1,
            code: product.code,
            name: product.name,
          }];
        if (primaryComponents.some((item) => !item.ticket_product_id)) {
          return rollbackFail(conn, res, 'COURSE_TICKET_PRODUCT_REQUIRED', '銷售方案尚未設定票券產品', 409);
        }
        v2OrderItems = primaryComponents.map((item, index) => ({
          shopProductId: Number(product.id),
          ticketProductId: Number(item.ticket_product_id),
          itemType: text(item.component_role, 24) || (index === 0 ? 'primary' : `component_${index + 1}`),
          code: item.code,
          name: item.name,
          quantity: Number(item.component_quantity || 1) * quantity,
          unitPrice: index === 0 ? money(product.price) : 0,
          lineTotal: index === 0 ? money(product.price) * quantity : 0,
          metadata: { componentRole: item.component_role || 'primary' },
        }));
        const [addonRows] = await conn.query(
          `SELECT requirement.quantity AS required_quantity,
                  addon.id AS shop_product_id, addon.code, addon.name, addon.price,
                  addon.ticket_product_id, addon.owner_user_id, addon.status,
                  tp.code AS ticket_product_code, tp.name AS ticket_product_name
             FROM course_product_required_addons requirement
             JOIN course_products addon ON addon.id = requirement.addon_product_id
             JOIN course_ticket_products tp ON tp.id = addon.ticket_product_id
            WHERE requirement.product_id = ?
            ORDER BY requirement.sort_order, addon.id
            FOR UPDATE`,
          [product.id]
        );
        if (includeRequiredAddons && !addonRows.length) {
          return rollbackFail(
            conn,
            res,
            'COURSE_REQUIRED_ADDON_UNAVAILABLE',
            '此銷售方案要求新生加購，但尚未設定可發行的必要加購品',
            409
          );
        }
        for (const addon of includeRequiredAddons ? addonRows : []) {
          if (!isBundleIssuableShopProductStatus(addon.status)
            || String(addon.owner_user_id || '') !== String(product.owner_user_id || '')) {
            return rollbackFail(conn, res, 'COURSE_REQUIRED_ADDON_UNAVAILABLE', '必要加購品已下架或租戶已變更', 409);
          }
          const addonQuantity = Number(addon.required_quantity || 1) * quantity;
          v2OrderItems.push({
            shopProductId: Number(addon.shop_product_id),
            ticketProductId: Number(addon.ticket_product_id),
            itemType: 'required_addon',
            code: addon.ticket_product_code || addon.code,
            name: addon.ticket_product_name || addon.name,
            quantity: addonQuantity,
            unitPrice: money(addon.price),
            lineTotal: money(addon.price) * addonQuantity,
            metadata: { requiredByProductId: Number(product.id) },
          });
        }
      }
      const expectedUnitPriceRaw = firstOwnField(req.body, ['expectedUnitPrice', 'expected_unit_price']);
      if (expectedUnitPriceRaw !== undefined
        && money(expectedUnitPriceRaw, -1) !== money(product.price, -2)) {
        return rollbackFail(conn, res, 'COURSE_PRODUCT_PRICE_CHANGED', '課程價格已變更，請重新確認訂單內容', 409);
      }
      const expectedOwnerRaw = firstOwnField(req.body, [
        'expectedOwnerUserId', 'expected_owner_user_id', 'expectedProviderUserId', 'expected_provider_user_id',
      ]);
      if (expectedOwnerRaw !== undefined
        && String(text(expectedOwnerRaw, 36) || '') !== String(product.owner_user_id || '')) {
        return rollbackFail(conn, res, 'COURSE_PRODUCT_OWNER_CHANGED', '課程服務商已變更，請重新閱讀條款並確認訂單', 409);
      }
      if (normalizeCourseCoverUrl(product.external_purchase_url)) {
        return rollbackFail(conn, res, 'COURSE_EXTERNAL_PURCHASE_REQUIRED', '此課程需前往服務商網站購買', 409);
      }
      const code = await uniqueCode('course_orders', 'CO', conn);
      const unitPrice = money(product.price);
      const total = courseV2.enabled
        ? v2OrderItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)
        : unitPrice * quantity;
      const expectedTotalRaw = firstOwnField(req.body, ['expectedTotalAmount', 'expected_total_amount']);
      if (courseV2.enabled && expectedTotalRaw !== undefined
        && money(expectedTotalRaw, -1) !== money(total, -2)) {
        return rollbackFail(conn, res, 'COURSE_ORDER_PREVIEW_CHANGED', '加購或訂單總額已變更，請重新確認', 409);
      }
      const orderStudent = courseV2.enabled
        ? await ensureCourseStudent(conn, {
          ownerUserId: product.owner_user_id,
          userId: req.user.id,
          email: buyerEmail,
          displayName: buyerName,
        })
        : null;
      const [result] = courseV2.enabled
        ? await conn.query(
          `INSERT INTO course_orders
             (code, user_id, student_id, buyer_name, buyer_email, buyer_phone,
              product_id, quantity, unit_price, total_amount, remittance_last5,
              status, terms_accepted_at, note, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?, 1)`,
          [
            code,
            req.user.id,
            orderStudent.id,
            buyerName,
            buyerEmail,
            buyerPhone || null,
            product.id,
            quantity,
            unitPrice,
            total,
            remittanceLast5 || null,
            text(req.body?.note, 1000) || null,
          ]
        )
        : await conn.query(
          `INSERT INTO course_orders
             (code, user_id, buyer_name, buyer_email, buyer_phone, product_id,
              quantity, unit_price, total_amount, remittance_last5, status,
              terms_accepted_at, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
          [
            code,
            req.user.id,
            buyerName,
            buyerEmail,
            buyerPhone || null,
            product.id,
            quantity,
            unitPrice,
            total,
            remittanceLast5 || null,
            text(req.body?.note, 1000) || null,
          ]
        );
      const orderId = Number(result.insertId);
      if (courseV2.enabled) {
        for (const item of v2OrderItems) {
          await conn.query(
            `INSERT INTO course_order_items
              (order_id, shop_product_id, ticket_product_id, item_type,
               item_code_snapshot, item_name_snapshot, quantity, unit_price,
               line_total, issuance_status, metadata_json, row_version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1)`,
            [
              orderId,
              item.shopProductId,
              item.ticketProductId,
              item.itemType,
              item.code,
              item.name,
              item.quantity,
              item.unitPrice,
              item.lineTotal,
              JSON.stringify(item.metadata || {}),
            ]
          );
        }
      }
      const response = {
        id: orderId,
        code,
        status: 'pending',
        totalAmount: total,
        ...(courseV2.enabled ? {
          rowVersion: 1,
          items: v2OrderItems,
        } : {}),
      };
      const message = '課程訂單已建立';
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'order.create',
          v2Mutation,
          response,
          { type: 'order', id: orderId }
        );
      } else {
        await completeCourseIdempotency(conn, req.user.id, idempotency, { data: response, message });
      }
      await conn.commit();
      notification = {
        to: buyerEmail,
        ...buildCourseOrderConfirmationEmail({
          code,
          buyerName,
          productName: product.name,
          quantity,
          totalAmount: total,
          remittanceLast5,
          webBase: PUBLIC_WEB_URL,
        }),
      };
      try { await sendCourseNotificationEmail(notification); } catch (mailError) {
        console.error('[courses] COURSE_ORDER_EMAIL_FAIL:', mailError?.message || mailError);
      }
      return ok(res, response, message);
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_ORDER_CREATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/courses/me', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      if (courseV2.enabled) {
        await courseV2.assertSchema();
        await courseV2.withTransaction(async (conn) => {
          const [verifiedRows] = await conn.query(
            `SELECT u.email,
                    (
                      EXISTS(
                        SELECT 1 FROM email_verifications ev
                         WHERE LOWER(ev.email) = LOWER(u.email) AND ev.verified = 1
                      )
                      OR EXISTS(
                        SELECT 1 FROM oauth_identities oi
                         WHERE oi.user_id = u.id AND LOWER(COALESCE(oi.email, u.email)) = LOWER(u.email)
                      )
                    ) AS email_verified
               FROM users u WHERE u.id = ? LIMIT 1 FOR UPDATE`,
            [req.user.id]
          );
          const verifiedUser = verifiedRows[0];
          if (verifiedUser?.email_verified) {
            try {
              await courseV2.claimStudentForVerifiedEmail(conn, {
                userId: req.user.id,
                email: verifiedUser.email,
              });
            } catch (error) {
              if (error?.code !== 'COURSE_WRITES_FROZEN') throw error;
            }
          }
        });
      }
      const paging = pagingOptions(req, { defaultLimit: 10, maxLimit: 100 });
      const view = queryText(req.query?.view, 20).toLowerCase();
      if (paging.paged && ['tickets', 'bookings', 'orders'].includes(view)) {
        const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]']);
        const where = [];
        const params = [];
        let fromSql;
        let selectSql;
        let orderSql;
        let mapper;
        let statusColumn;
        if (view === 'tickets') {
          where.push('t.user_id = ?');
          params.push(req.user.id);
          fromSql = courseV2.enabled
            ? `FROM course_tickets t
               LEFT JOIN course_products p ON p.id = t.product_id
               LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
               LEFT JOIN users provider ON provider.id = COALESCE(t.provider_user_id_snapshot, p.owner_user_id)`
            : `FROM course_tickets t JOIN course_products p ON p.id = t.product_id
               LEFT JOIN users provider ON provider.id = p.owner_user_id`;
          selectSql = courseV2.enabled
            ? `SELECT t.*, COALESCE(t.product_name_snapshot, tp.name, p.name, '') AS product_name,
                      COALESCE(t.provider_user_id_snapshot, p.owner_user_id) AS owner_user_id,
                      COALESCE(t.provider_name_snapshot, provider.username, '') AS provider_name`
            : `SELECT t.*, p.name AS product_name, p.owner_user_id, provider.username AS provider_name`;
          orderSql = 't.created_at DESC, t.id DESC';
          statusColumn = 't.status';
          mapper = toTicket;
          if (paging.q) {
            where.push('(t.code LIKE ? OR p.name LIKE ? OR provider.username LIKE ?)');
            params.push(...Array(3).fill(`%${paging.q}%`));
          }
        } else if (view === 'bookings') {
          where.push(courseV2.enabled
            ? '(b.user_id = ? OR booking_student.user_id = ?)'
            : 'b.user_id = ?');
          params.push(req.user.id, ...(courseV2.enabled ? [req.user.id] : []));
          fromSql = `FROM course_bookings b
                     JOIN course_sessions s ON s.id = b.session_id
                     ${courseV2.enabled ? 'LEFT JOIN course_students booking_student ON booking_student.id = b.student_id' : ''}
                     ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_tickets t ON t.id = b.ticket_id
                     ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_products p ON p.id = t.product_id
                     ${courseV2.enabled ? 'LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id' : ''}
                     LEFT JOIN users coach ON coach.id = s.coach_user_id
                     LEFT JOIN users provider ON provider.id = ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'}`;
          selectSql = `SELECT b.*, s.code AS session_code, s.title AS session_title, s.location, s.starts_at, s.ends_at,
                              s.cancel_close_minutes_before, s.redeem_close_at,
                              s.redeem_close_minutes_after, s.settings_snapshot_json,
                              COALESCE(s.coach_name, coach.username, '') AS coach_name, t.code AS ticket_code,
                              COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses,
                              p.id AS product_id,
                              ${courseV2.enabled ? "COALESCE(t.product_name_snapshot, tp.name, p.name, '')" : 'p.name'} AS product_name,
                              ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'} AS owner_user_id,
                              ${courseV2.enabled ? "COALESCE(t.provider_name_snapshot, provider.username, '')" : 'provider.username'} AS provider_name`;
          orderSql = 's.starts_at DESC, b.id DESC';
          statusColumn = 'b.status';
          mapper = toCourseBooking;
          if (paging.q) {
            where.push("(s.title LIKE ? OR s.location LIKE ? OR t.code LIKE ? OR p.name LIKE ? OR provider.username LIKE ? OR COALESCE(s.coach_name, coach.username, '') LIKE ?)");
            params.push(...Array(6).fill(`%${paging.q}%`));
          }
          const upcoming = queryBoolean(req.query?.upcoming);
          if (upcoming === true) where.push('s.ends_at >= NOW()');
          if (upcoming === false) where.push('s.ends_at < NOW()');
        } else {
          where.push(courseV2.enabled
            ? '(o.user_id = ? OR order_student.user_id = ?)'
            : 'o.user_id = ?');
          params.push(req.user.id, ...(courseV2.enabled ? [req.user.id] : []));
          fromSql = courseV2.enabled
            ? `FROM course_orders o
               LEFT JOIN course_products p ON p.id = o.product_id
               LEFT JOIN course_students order_student ON order_student.id = o.student_id
               LEFT JOIN users provider ON provider.id = COALESCE(p.owner_user_id, order_student.owner_user_id)`
            : `FROM course_orders o JOIN course_products p ON p.id = o.product_id
               LEFT JOIN users provider ON provider.id = p.owner_user_id`;
          selectSql = `SELECT o.*, COALESCE(p.name, '') AS product_name,
                              ${courseV2.enabled ? 'COALESCE(p.owner_user_id, order_student.owner_user_id)' : 'p.owner_user_id'} AS owner_user_id,
                              provider.username AS provider_name,
                              (SELECT COUNT(*) FROM course_tickets issued WHERE issued.order_id = o.id) AS issued_ticket_count,
                              (SELECT GROUP_CONCAT(issued.code ORDER BY issued.id SEPARATOR ',') FROM course_tickets issued WHERE issued.order_id = o.id) AS ticket_codes`;
          orderSql = 'o.created_at DESC, o.id DESC';
          statusColumn = 'o.status';
          mapper = toCourseOrder;
          if (paging.q) {
            where.push('(o.code LIKE ? OR p.name LIKE ? OR provider.username LIKE ?)');
            params.push(...Array(3).fill(`%${paging.q}%`));
          }
        }
        if (statuses.length) {
          where.push(`${statusColumn} IN (${statuses.map(() => '?').join(',')})`);
          params.push(...statuses);
        }
        const [rows] = await pool.query(
          `${selectSql} ${fromSql} WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
          [...params, paging.limit, paging.offset]
        );
        const [[countRow]] = await pool.query(
          `SELECT COUNT(*) AS total ${fromSql} WHERE ${where.join(' AND ')}`,
          params
        );
        const summaryFrom = view === 'tickets'
          ? (courseV2.enabled
            ? 'course_tickets t LEFT JOIN course_students summary_student ON summary_student.id = t.student_id'
            : 'course_tickets t')
          : view === 'bookings'
            ? (courseV2.enabled
              ? 'course_bookings b LEFT JOIN course_students summary_student ON summary_student.id = b.student_id'
              : 'course_bookings b')
            : (courseV2.enabled
              ? 'course_orders o LEFT JOIN course_students summary_student ON summary_student.id = o.student_id'
              : 'course_orders o');
        const summaryUserColumn = view === 'tickets' ? 't.user_id'
          : view === 'bookings' ? 'b.user_id' : 'o.user_id';
        const summaryStatusColumn = view === 'tickets' ? 't.status' : view === 'bookings' ? 'b.status' : 'o.status';
        const [summaryRows] = await pool.query(
          `SELECT ${summaryStatusColumn} AS status, COUNT(*) AS total
             FROM ${summaryFrom}
            WHERE ${courseV2.enabled
    ? `(${summaryUserColumn} = ? OR summary_student.user_id = ?)`
    : `${summaryUserColumn} = ?`}
            GROUP BY ${summaryStatusColumn}`,
          [req.user.id, ...(courseV2.enabled ? [req.user.id] : [])]
        );
        const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
        const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
        const balancedRows = courseV2.enabled && view === 'tickets'
          ? await courseV2.enrichTicketBalances(rows, req.user.id)
          : (courseV2.enabled && view === 'orders'
            ? await attachCourseOrderItems(pool, rows)
            : rows);
        const items = view === 'tickets'
          ? attachCourseTicketRedemptionBookings(
            balancedRows,
            await loadCourseTicketRedemptionBookings(balancedRows, req.user.id)
          )
          : (courseV2.enabled && view === 'bookings'
            ? await enrichCourseBookingPolicies(balancedRows)
            : balancedRows.map(mapper));
        return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
      }
      const [ticketRows] = await pool.query(
        `SELECT t.*,
                ${courseV2.enabled ? "COALESCE(t.product_name_snapshot, tp.name, p.name, '')" : 'p.name'} AS product_name,
                ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'} AS owner_user_id,
                ${courseV2.enabled ? "COALESCE(t.provider_name_snapshot, provider.username, '')" : 'provider.username'} AS provider_name
           FROM course_tickets t
           ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_products p ON p.id = t.product_id
           ${courseV2.enabled ? 'LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id' : ''}
           LEFT JOIN users provider ON provider.id = ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'}
          WHERE t.user_id = ?
          ORDER BY t.created_at DESC, t.id DESC`,
        [req.user.id]
      );
      const balancedTicketRows = courseV2.enabled
        ? await courseV2.enrichTicketBalances(ticketRows, req.user.id)
        : ticketRows;
      const ticketRedemptionBookings = await loadCourseTicketRedemptionBookings(balancedTicketRows, req.user.id);
      const [bookingRows] = await pool.query(
        `SELECT b.*, s.code AS session_code, s.title AS session_title, s.location, s.starts_at, s.ends_at,
                s.cancel_close_minutes_before, s.redeem_close_at,
                s.redeem_close_minutes_after, s.settings_snapshot_json,
                COALESCE(s.coach_name, coach.username, '') AS coach_name, t.code AS ticket_code,
                COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses,
                p.id AS product_id,
                ${courseV2.enabled ? "COALESCE(t.product_name_snapshot, tp.name, p.name, '')" : 'p.name'} AS product_name,
                ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'} AS owner_user_id,
                ${courseV2.enabled ? "COALESCE(t.provider_name_snapshot, provider.username, '')" : 'provider.username'} AS provider_name
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           ${courseV2.enabled ? 'LEFT JOIN course_students booking_student ON booking_student.id = b.student_id' : ''}
           ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_tickets t ON t.id = b.ticket_id
           ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_products p ON p.id = t.product_id
           ${courseV2.enabled ? 'LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id' : ''}
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = ${courseV2.enabled ? 'COALESCE(t.provider_user_id_snapshot, p.owner_user_id)' : 'p.owner_user_id'}
          WHERE ${courseV2.enabled
    ? '(b.user_id = ? OR booking_student.user_id = ?)'
    : 'b.user_id = ?'}
          ORDER BY s.starts_at DESC, b.id DESC`,
        [req.user.id, ...(courseV2.enabled ? [req.user.id] : [])]
      );
      const [orderRows] = await pool.query(
        `SELECT o.*, COALESCE(p.name, '') AS product_name,
                ${courseV2.enabled ? 'COALESCE(p.owner_user_id, order_student.owner_user_id)' : 'p.owner_user_id'} AS owner_user_id,
                provider.username AS provider_name,
                (SELECT COUNT(*) FROM course_tickets issued WHERE issued.order_id = o.id) AS issued_ticket_count,
                (SELECT GROUP_CONCAT(issued.code ORDER BY issued.id SEPARATOR ',') FROM course_tickets issued WHERE issued.order_id = o.id) AS ticket_codes
           FROM course_orders o
           ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_products p ON p.id = o.product_id
           ${courseV2.enabled ? 'LEFT JOIN course_students order_student ON order_student.id = o.student_id' : ''}
           LEFT JOIN users provider ON provider.id = ${courseV2.enabled
    ? 'COALESCE(p.owner_user_id, order_student.owner_user_id)'
    : 'p.owner_user_id'}
          WHERE ${courseV2.enabled
    ? '(o.user_id = ? OR order_student.user_id = ?)'
    : 'o.user_id = ?'}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT 100`,
        [req.user.id, ...(courseV2.enabled ? [req.user.id] : [])]
      );
      const ordersWithItems = courseV2.enabled
        ? await attachCourseOrderItems(pool, orderRows)
        : orderRows;
      const bookingsWithPolicy = courseV2.enabled
        ? await enrichCourseBookingPolicies(bookingRows)
        : bookingRows.map(toCourseBooking);
      return ok(res, {
        tickets: attachCourseTicketRedemptionBookings(balancedTicketRows, ticketRedemptionBookings),
        bookings: bookingsWithPolicy,
        orders: ordersWithItems.map(toCourseOrder),
      });
    } catch (error) {
      return handleError(res, 'COURSE_ME_FAIL', error);
    }
  });

  router.patch('/courses/orders/:id', authRequired, async (req, res) => {
    const v2IdempotencyKey = courseV2.mutationKeyFromRequest(req);
    if (courseV2.enabled && !v2IdempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '更新課程訂單需要 Idempotency-Key', 400);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      if (courseV2.enabled) await courseV2.assertMutationAllowed(conn);
      let v2Mutation = null;
      if (courseV2.enabled) {
        v2Mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'order.update',
          idempotencyKey: v2IdempotencyKey,
          payload: {
            orderId: positiveInt(req.params.id),
            quantity: positiveInt(req.body?.quantity),
            rowVersion: courseV2.rowVersionFromRequest(req),
            remittanceLast5: text(req.body?.remittanceLast5 ?? req.body?.remittance_last5, 5),
          },
          resourceType: 'order',
          resourceId: positiveInt(req.params.id),
        });
        if (v2Mutation.replay) {
          await conn.commit();
          return ok(res, v2Mutation.replay, '課程訂單已更新');
        }
      }
      const contact = await loadConfirmedCourseContact(
        req,
        conn,
        req.body?.contactConfirmation ?? req.body?.contact_confirmation
      );
      if (contact.error) return rollbackFail(conn, res, ...contact.error);
      const [rows] = await conn.query(
        courseV2.enabled
          ? `SELECT o.*
               FROM course_orders o
               LEFT JOIN course_students student ON student.id = o.student_id
              WHERE o.id = ? AND (o.user_id = ? OR student.user_id = ?)
              LIMIT 1 FOR UPDATE`
          : `SELECT o.* FROM course_orders o
              WHERE o.id = ? AND o.user_id = ? LIMIT 1 FOR UPDATE`,
        [
          positiveInt(req.params.id),
          req.user.id,
          ...(courseV2.enabled ? [req.user.id] : []),
        ]
      );
      const order = rows[0];
      if (!order) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      if (!['pending', 'payment_review'].includes(String(order.status))) {
        return rollbackFail(conn, res, 'COURSE_ORDER_LOCKED', '此訂單已付款或已發券，不能再修改', 409);
      }
      const quantity = positiveInt(req.body?.quantity, Number(order.quantity), 10);
      if (courseV2.enabled) {
        const expectedRowVersion = courseV2.rowVersionFromRequest(req);
        if (!expectedRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '更新課程訂單需要 If-Match', 428);
        }
        if (Number(order.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '課程訂單已變更，請重新載入', 409);
        }
        if (Number(quantity) !== Number(order.quantity)) {
          return rollbackFail(
            conn,
            res,
            'COURSE_ORDER_QUANTITY_IMMUTABLE',
            '新版課程訂單的商品與加購明細建立後不可變更數量，請取消後重新下單',
            409
          );
        }
      }
      const submittedLast5 = text(req.body?.remittanceLast5 ?? req.body?.remittance_last5 ?? contact.current.remittanceLast5, 5);
      if (submittedLast5 !== contact.current.remittanceLast5) {
        return rollbackFail(conn, res, 'COURSE_CONTACT_CHANGED', '匯款帳號後五碼與目前會員資料不一致', 409);
      }
      const totalAmount = courseV2.enabled
        ? Number(order.total_amount || 0)
        : money(order.unit_price) * quantity;
      const status = order.status === 'payment_review' ? 'pending' : order.status;
      const [updateResult] = courseV2.enabled
        ? await conn.query(
          `UPDATE course_orders
              SET buyer_name = ?, buyer_email = ?, buyer_phone = ?,
                  remittance_last5 = ?, status = ?, row_version = row_version + 1
            WHERE id = ? AND status IN ('pending','payment_review') AND row_version = ?`,
          [
            contact.current.username,
            contact.current.email,
            contact.current.phone,
            contact.current.remittanceLast5,
            status,
            order.id,
            Number(order.row_version || 1),
          ]
        )
        : await conn.query(
          `UPDATE course_orders
              SET buyer_name = ?, buyer_email = ?, buyer_phone = ?, quantity = ?, total_amount = ?,
                  remittance_last5 = ?, status = ?
            WHERE id = ? AND user_id = ? AND status IN ('pending','payment_review')`,
          [
            contact.current.username,
            contact.current.email,
            contact.current.phone,
            quantity,
            totalAmount,
            contact.current.remittanceLast5,
            status,
            order.id,
            req.user.id,
          ]
        );
      if (courseV2.enabled && !updateResult.affectedRows) {
        return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '課程訂單已變更，請重新載入', 409);
      }
      const response = {
        id: Number(order.id),
        quantity,
        totalAmount,
        status,
        ...(courseV2.enabled ? { rowVersion: Number(order.row_version || 1) + 1 } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'order.update',
          v2Mutation,
          response,
          { type: 'order', id: order.id }
        );
      }
      await conn.commit();
      return ok(res, response, '課程訂單已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_ORDER_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.post('/courses/orders/:id/cancel', authRequired, async (req, res) => {
    const v2IdempotencyKey = courseV2.mutationKeyFromRequest(req);
    if (courseV2.enabled && !v2IdempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '取消課程訂單需要 Idempotency-Key', 400);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      let v2Mutation = null;
      if (courseV2.enabled) {
        v2Mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'order.cancel',
          idempotencyKey: v2IdempotencyKey,
          payload: {
            orderId: positiveInt(req.params.id),
            rowVersion: courseV2.rowVersionFromRequest(req),
          },
          resourceType: 'order',
          resourceId: positiveInt(req.params.id),
        });
        if (v2Mutation.replay) {
          await conn.commit();
          return ok(res, v2Mutation.replay, '課程訂單已取消');
        }
      }
      const [rows] = await conn.query(
        `SELECT id, status${courseV2.enabled ? ', row_version' : ''}
           FROM course_orders WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [positiveInt(req.params.id), req.user.id]
      );
      const order = rows[0];
      if (!order) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      if (!['pending', 'payment_review'].includes(String(order.status))) {
        return rollbackFail(conn, res, 'COURSE_ORDER_CANCEL_FAIL', '只有待付款或款項審核中的訂單可取消', 409);
      }
      if (courseV2.enabled) {
        const expectedRowVersion = courseV2.rowVersionFromRequest(req);
        if (!expectedRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '取消課程訂單需要 If-Match', 428);
        }
        if (Number(order.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '課程訂單已變更，請重新載入', 409);
        }
      }
      const [updateResult] = await conn.query(
        `UPDATE course_orders SET status = 'cancelled'${courseV2.enabled ? ', row_version = row_version + 1' : ''}
          WHERE id = ? AND user_id = ? AND status IN ('pending','payment_review')
            ${courseV2.enabled ? 'AND row_version = ?' : ''}`,
        [order.id, req.user.id, ...(courseV2.enabled ? [Number(order.row_version || 1)] : [])]
      );
      if (courseV2.enabled && !updateResult.affectedRows) {
        return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '課程訂單已變更，請重新載入', 409);
      }
      const response = {
        id: Number(order.id),
        status: 'cancelled',
        ...(courseV2.enabled ? { rowVersion: Number(order.row_version || 1) + 1 } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'order.cancel',
          v2Mutation,
          response,
          { type: 'order', id: order.id }
        );
      }
      await conn.commit();
      return ok(res, response, '課程訂單已取消');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_ORDER_CANCEL_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.post('/courses/sessions/:id/book', authRequired, async (req, res) => {
    let idempotency;
    const v2IdempotencyKey = courseV2.mutationKeyFromRequest(req);
    if (courseV2.enabled && !v2IdempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '預約需要 Idempotency-Key', 400);
    }
    if (v2IdempotencyKey && !req.body?.idempotencyKey && !req.body?.idempotency_key) {
      req.body = { ...(req.body || {}), idempotencyKey: v2IdempotencyKey };
    }
    try {
      idempotency = buildCourseIdempotency(req.body || {}, 'booking.create', {
        sessionId: positiveInt(req.params.id),
        ticketId: positiveInt(req.body?.ticketId ?? req.body?.ticket_id),
        contactConfirmation: normalizeOrderContact(
          req.body?.contactConfirmation ?? req.body?.contact_confirmation ?? {}
        ),
        legacyConfirmation: req.body?.userDataConfirmation ?? req.body?.user_data_confirmation ?? null,
      });
    } catch (error) {
      return handleError(res, 'COURSE_BOOKING_CREATE_FAIL', error);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      if (courseV2.enabled) await courseV2.assertMutationAllowed(conn);
      let v2Mutation = null;
      const claim = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'booking.create',
          idempotencyKey: v2IdempotencyKey,
          payload: {
            sessionId: positiveInt(req.params.id),
            requestedTicketId: positiveInt(req.body?.ticketId ?? req.body?.ticket_id),
            sessionRowVersion: courseV2.rowVersionFromRequest(req),
            ticketRowVersion: positiveInt(
              req.get?.('X-Course-Ticket-If-Match')
                || req.get?.('X-Ticket-If-Match')
                || req.body?.expectedTicketRowVersion
                || req.body?.expected_ticket_row_version
            ),
          },
          resourceType: 'session',
          resourceId: positiveInt(req.params.id),
        })
        : await claimCourseIdempotency(conn, req.user.id, idempotency);
      if (courseV2.enabled) v2Mutation = claim;
      if (claim.replay) {
        await conn.commit();
        return courseV2.enabled
          ? ok(res, claim.replay, '預約成功；到場請出示 QR Code 核銷')
          : ok(res, claim.replay.data, claim.replay.message);
      }
      const sessionId = positiveInt(req.params.id);
      let ticketId = positiveInt(req.body?.ticketId ?? req.body?.ticket_id);
      if (!sessionId || (!ticketId && !courseV2.enabled)) {
        return rollbackFail(conn, res, 'VALIDATION_ERROR', '請選擇場次與票券', 400);
      }
      const [sessionRows] = await conn.query(
        `SELECT s.*,
                (SELECT COUNT(*) FROM course_bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) AS booked_count
           FROM course_sessions s WHERE s.id = ? LIMIT 1 FOR UPDATE`,
        [sessionId]
      );
      const session = sessionRows[0];
      if (!session || session.status !== 'open') return rollbackFail(conn, res, 'COURSE_SESSION_NOT_OPEN', '此場次目前未開放預約', 409);
      let v2Eligibility = null;
      let expectedTicketRowVersion = null;
      if (courseV2.enabled) {
        const expectedSessionRowVersion = courseV2.rowVersionFromRequest(req);
        if (!expectedSessionRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '預約需要場次 If-Match', 428);
        }
        if (Number(session.row_version || 1) !== Number(expectedSessionRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        }
        v2Eligibility = await courseV2.getSessionEligibility({
          sessionId,
          userId: req.user.id,
          ticketId,
          queryable: conn,
        });
        ticketId = ticketId || v2Eligibility.selectedTicketId;
        const selectedEligibility = v2Eligibility.tickets.find((item) => Number(item.ticketId) === Number(ticketId));
        if (!v2Eligibility.policy.canBook || !selectedEligibility?.eligible) {
          return rollbackFail(
            conn,
            res,
            'COURSE_TICKET_NOT_APPLICABLE',
            v2Eligibility.reason || selectedEligibility?.reasons?.[0] || '沒有可預約的票券',
            409
          );
        }
        expectedTicketRowVersion = positiveInt(
          req.get?.('X-Course-Ticket-If-Match')
            || req.get?.('X-Ticket-If-Match')
            || req.body?.expectedTicketRowVersion
            || req.body?.expected_ticket_row_version
        );
        if (!expectedTicketRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '預約需要票券 row version', 428);
        }
        if (Number(selectedEligibility.rowVersion) !== Number(expectedTicketRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
      }
      const now = Date.now();
      if (!courseV2.enabled) {
        if (session.booking_open_at && new Date(session.booking_open_at).getTime() > now) return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_STARTED', '此場次尚未開放預約', 409);
        if (session.booking_close_at && new Date(session.booking_close_at).getTime() < now) return rollbackFail(conn, res, 'COURSE_BOOKING_CLOSED', '此場次已截止預約', 409);
        if (new Date(session.ends_at).getTime() < now) return rollbackFail(conn, res, 'COURSE_SESSION_ENDED', '此場次已結束', 409);
      }
      if (Number(session.capacity) > 0 && Number(session.booked_count) >= Number(session.capacity)) return rollbackFail(conn, res, 'COURSE_SESSION_FULL', '此場次名額已滿', 409);
      const [ticketRows] = courseV2.enabled
        ? await conn.query(
          `SELECT t.*,
                  COALESCE(t.product_valid_days_snapshot, tp.valid_days, p.valid_days) AS valid_days,
                  COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) AS owner_user_id
             FROM course_tickets t
             LEFT JOIN course_students student ON student.id = t.student_id
             LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
             LEFT JOIN course_products p ON p.id = t.product_id
            WHERE t.id = ?
              AND (t.user_id = ? OR (t.user_id IS NULL AND student.user_id = ?))
            LIMIT 1 FOR UPDATE`,
          [ticketId, req.user.id, req.user.id]
        )
        : await conn.query(
          `SELECT t.*, p.valid_days, p.owner_user_id
             FROM course_tickets t JOIN course_products p ON p.id = t.product_id
            WHERE t.id = ? AND t.user_id = ? LIMIT 1 FOR UPDATE`,
          [ticketId, req.user.id]
        );
      const ticket = ticketRows[0];
      if (!ticket) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '找不到可用票券', 404);
      if (courseV2.enabled && Number(ticket.row_version || 1) !== Number(expectedTicketRowVersion)) {
        return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      if (
        !['pending', 'active'].includes(ticket.status)
        || ticket.frozen_at
        || Number(ticket.remaining_uses_cache ?? ticket.remaining_uses) <= 0
      ) {
        return rollbackFail(conn, res, 'COURSE_TICKET_UNAVAILABLE', '此票券目前不可預約', 409);
      }
      if (
        ticket.expires_at
        && courseCalendarDate(ticket.expires_at) < courseCalendarDate(now)
      ) {
        return rollbackFail(conn, res, 'COURSE_TICKET_EXPIRED', '此票券已過期', 409);
      }
      if (
        ticket.status === 'pending'
        && ticket.activation_deadline
        && courseCalendarDate(ticket.activation_deadline) < courseCalendarDate(now)
      ) {
        return rollbackFail(conn, res, 'COURSE_TICKET_ACTIVATION_EXPIRED', '此票券已超過開卡期限', 409);
      }
      if (!courseV2.enabled && session.product_id && Number(session.product_id) !== Number(ticket.product_id)) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_APPLICABLE', '此票券不適用該場次', 409);
      if (String(session.owner_user_id || '') !== String(ticket.owner_user_id || '')) {
        return rollbackFail(conn, res, 'COURSE_TICKET_NOT_APPLICABLE', '此票券不屬於該場次服務商', 409);
      }
      let attendeeName = text(req.body?.attendeeName ?? req.body?.attendee_name ?? req.user?.username, 255);
      let attendeeEmail = normalizeCourseTransferEmail(req.body?.attendeeEmail ?? req.body?.attendee_email ?? req.user?.email);
      const contactConfirmation = req.body?.contactConfirmation ?? req.body?.contact_confirmation;
      if (idempotency && contactConfirmation === undefined) {
        const [userRows] = await conn.query(
          'SELECT username, email, phone, remittance_last5 FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
          [req.user.id]
        );
        const currentUser = userRows[0];
        const currentName = text(currentUser?.username, 255);
        const currentEmail = normalizeCourseTransferEmail(currentUser?.email);
        if (!currentUser) return rollbackFail(conn, res, 'USER_NOT_FOUND', '找不到使用者', 404);
        if (!currentName || !currentEmail) return rollbackFail(conn, res, 'COURSE_CONTACT_INCOMPLETE', '請先完成真實姓名與 Email', 400);
        attendeeName = currentName;
        attendeeEmail = currentEmail;
      }
      if (contactConfirmation !== undefined) {
        const contact = await loadConfirmedCourseContact(req, conn, contactConfirmation);
        if (contact.error) return rollbackFail(conn, res, ...contact.error);
        attendeeName = contact.current.username;
        attendeeEmail = contact.current.email;
      }
      if (!attendeeName || !attendeeEmail) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請填寫出席者姓名與正確 Email', 400);
      if (contactConfirmation === undefined) {
        const userDataConfirmation = req.body?.userDataConfirmation ?? req.body?.user_data_confirmation;
        if (!userDataConfirmation || typeof userDataConfirmation !== 'object' || Array.isArray(userDataConfirmation)) {
          return rollbackFail(conn, res, 'COURSE_USER_DATA_CONFIRMATION_REQUIRED', '請再次核對出席者資料後再送出預約', 400);
        }
        if (!courseUserDataConfirmationMatches(userDataConfirmation, { attendeeName, attendeeEmail })) {
          return rollbackFail(conn, res, 'COURSE_USER_DATA_CONFIRMATION_CHANGED', '出席者資料已變更，請重新核對後再預約', 409);
        }
      }
      const [existing] = await conn.query(
        `SELECT id, status${courseV2.enabled ? ', row_version' : ''}
           FROM course_bookings WHERE session_id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [sessionId, req.user.id]
      );
      const verifyCode = await generateCourseBookingVerificationCode(conn);
      let bookingId;
      let bookingRowVersion = 1;
      if (existing.length) {
        if (existing[0].status !== 'cancelled') return rollbackFail(conn, res, 'COURSE_ALREADY_BOOKED', '你已預約此場次', 409);
        await conn.query(
          `UPDATE course_bookings SET ticket_id = ?, student_id = ?, attendee_name = ?, attendee_email = ?, verify_code = ?, status = 'booked', booked_at = NOW(), cancelled_at = NULL, attended_at = NULL
            ${courseV2.enabled ? ', row_version = row_version + 1' : ''} WHERE id = ?`,
          [ticketId, ticket.student_id || null, attendeeName, attendeeEmail, verifyCode, existing[0].id]
        );
        bookingId = Number(existing[0].id);
        bookingRowVersion = Number(existing[0].row_version || 1) + (courseV2.enabled ? 1 : 0);
      } else {
        const [result] = await conn.query(
          `INSERT INTO course_bookings (session_id, ticket_id, user_id, student_id, attendee_name, attendee_email, verify_code, status${courseV2.enabled ? ', row_version' : ''})
           VALUES (?, ?, ?, ?, ?, ?, ?, 'booked'${courseV2.enabled ? ', 1' : ''})`,
          [sessionId, ticketId, req.user.id, ticket.student_id || null, attendeeName, attendeeEmail, verifyCode]
        );
        bookingId = Number(result.insertId);
      }
      const hold = courseV2.enabled
        ? await courseV2.createHold(conn, {
          ticketId,
          bookingId,
          expiresAt: session.ends_at,
        })
        : null;
      const response = {
        id: bookingId,
        verifyCode,
        ...(courseV2.enabled ? {
          rowVersion: bookingRowVersion,
          ticketRowVersion: hold?.ticketRowVersion || expectedTicketRowVersion,
          hold,
          eligibility: v2Eligibility,
        } : {}),
      };
      const message = '預約成功；到場請出示 QR Code 核銷';
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'booking.create',
          v2Mutation,
          response,
          { type: 'booking', id: bookingId }
        );
      } else {
        await completeCourseIdempotency(conn, req.user.id, idempotency, { data: response, message });
      }
      await conn.commit();
      try {
        await sendCourseNotificationEmail({
          to: attendeeEmail,
          ...buildCourseBookingConfirmationEmail({
            bookingId,
            attendeeName,
            session,
            ticketCode: ticket.code,
            webBase: PUBLIC_WEB_URL,
          }),
        });
      } catch (mailError) {
        console.error('[courses] COURSE_BOOKING_EMAIL_FAIL:', mailError?.message || mailError);
      }
      return ok(res, response, message);
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_BOOKING_CREATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.delete('/courses/bookings/:id', authRequired, async (req, res) => {
    if (courseV2.enabled) {
      try {
        const result = await courseV2.cancelBooking({
          bookingId: req.params.id,
          actorUserId: req.user.id,
          userId: req.user.id,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
        });
        return ok(res, result, '預約已取消，保留堂數已釋放');
      } catch (error) {
        return handleError(res, 'COURSE_BOOKING_CANCEL_FAIL', error);
      }
    }
    try {
      await ensureSchema();
      const bookingId = positiveInt(req.params.id);
      const [result] = await pool.query(
        `UPDATE course_bookings b
            JOIN course_sessions s ON s.id = b.session_id
            SET b.status = 'cancelled', b.cancelled_at = NOW()
          WHERE b.id = ? AND b.user_id = ? AND b.status = 'booked' AND s.starts_at > NOW()`,
        [bookingId, req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_BOOKING_CANCEL_FAIL', '找不到可取消的預約，或場次已開始', 409);
      return ok(res, null, '預約已取消');
    } catch (error) {
      return handleError(res, 'COURSE_BOOKING_CANCEL_FAIL', error);
    }
  });

  router.post('/courses/bookings/:id/google-wallet', authRequired, async (req, res) => {
    const bookingId = positiveInt(req.params.id);
    if (!bookingId) return fail(res, 'VALIDATION_ERROR', '無效的課程預約編號', 400);
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT b.id, b.user_id, b.ticket_id, b.verify_code, b.status,
                s.code AS session_code, s.title AS session_title,
                DATE_FORMAT(s.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
                DATE_FORMAT(s.ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at,
                s.location,
                t.code AS ticket_code,
                COALESCE(t.product_name_snapshot, tp.name, p.name, s.title) AS product_name
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           JOIN course_tickets t ON t.id = b.ticket_id
           LEFT JOIN course_students booking_student ON booking_student.id = b.student_id
           LEFT JOIN course_students ticket_student ON ticket_student.id = t.student_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
          WHERE b.id = ?
            AND (b.user_id = ? OR booking_student.user_id = ?)
            AND (t.user_id = ? OR ticket_student.user_id = ?)
            AND b.status = 'booked'
            AND UPPER(TRIM(b.verify_code)) REGEXP '^CBK-[A-F0-9]{16,32}$'
          LIMIT 1`,
        [bookingId, req.user.id, req.user.id, req.user.id, req.user.id]
      );
      const booking = rows[0];
      if (!booking) return fail(res, 'COURSE_BOOKING_NOT_FOUND', '找不到可加入 Google 錢包的課程預約', 404);
      const verifyCode = normalizeCourseBookingVerificationCode(booking.verify_code);
      const validity = courseBookingGoogleWalletValidity(booking);
      if (!isCourseBookingVerificationCode(verifyCode) || !validity) {
        return fail(res, 'COURSE_BOOKING_NOT_REDEEMABLE', '此課程預約目前無法加入 Google 錢包', 409);
      }

      const result = courseBookingGoogleWalletSaveUrl({
        booking: {
          ...booking,
          verifyCode,
          startsAt: booking.starts_at,
          endsAt: booking.ends_at,
          ...validity,
        },
      });
      return ok(res, { saveUrl: result.saveUrl }, '已建立 Google 錢包課程票券');
    } catch (error) {
      if (error instanceof GoogleWalletConfigurationError) {
        return fail(res, error.code, 'Google 錢包功能尚未開放', 503);
      }
      console.error('[courses] COURSE_GOOGLE_WALLET_CREATE_FAIL:', error?.code || error?.message || error);
      return fail(res, 'COURSE_GOOGLE_WALLET_CREATE_FAIL', '課程票券建立失敗，請稍後再試', 500);
    }
  });

  router.post('/courses/tickets/:id/pause', authRequired, async (req, res) => {
    if (courseV2.enabled) {
      try {
        const result = await courseV2.changeTicketState({
          ticketId: req.params.id,
          userId: req.user.id,
          actorUserId: req.user.id,
          action: 'pause',
          reason: req.body?.reason,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
        });
        return ok(res, result, '票券已暫停');
      } catch (error) {
        return handleError(res, 'COURSE_TICKET_PAUSE_FAIL', error);
      }
    }
    try {
      await ensureSchema();
      const reason = text(req.body?.reason, 500);
      if (!reason) return fail(res, 'VALIDATION_ERROR', '請填寫暫停原因', 400);
      const [result] = await pool.query(
        `UPDATE course_tickets SET status = 'paused', paused_at = NOW(), pause_reason = ?
          WHERE id = ? AND user_id = ? AND status = 'active' AND remaining_uses > 0`,
        [reason, positiveInt(req.params.id), req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_TICKET_PAUSE_FAIL', '此票券目前無法暫停', 409);
      return ok(res, null, '票券已暫停');
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_PAUSE_FAIL', error);
    }
  });

  router.post('/courses/tickets/:id/resume', authRequired, async (req, res) => {
    if (courseV2.enabled) {
      try {
        const result = await courseV2.changeTicketState({
          ticketId: req.params.id,
          userId: req.user.id,
          actorUserId: req.user.id,
          action: 'resume',
          reason: req.body?.reason,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
        });
        return ok(res, result, '票券已恢復使用');
      } catch (error) {
        return handleError(res, 'COURSE_TICKET_RESUME_FAIL', error);
      }
    }
    try {
      await ensureSchema();
      const [result] = await pool.query(
        `UPDATE course_tickets SET status = 'active', paused_at = NULL, pause_reason = NULL
          WHERE id = ? AND user_id = ? AND status = 'paused' AND remaining_uses > 0`,
        [positiveInt(req.params.id), req.user.id]
      );
      if (!result.affectedRows) return fail(res, 'COURSE_TICKET_RESUME_FAIL', '此票券目前無法恢復', 409);
      return ok(res, null, '票券已恢復使用');
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_RESUME_FAIL', error);
    }
  });

  router.get('/courses/tickets/logs', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paged = booleanFlag(req.query?.paged, false);
      const defaultLimit = paged ? 50 : 100;
      const maxLimit = paged ? 200 : 500;
      const limit = Math.min(Math.max(positiveInt(req.query?.limit, defaultLimit), 1), maxLimit);
      const cursorText = paged ? String(req.query?.cursor || '').trim() : '';
      const cursorMatch = /^(\d+):(\d+)$/.exec(cursorText);
      const cursorTimestamp = cursorMatch ? positiveInt(cursorMatch[1]) : null;
      const cursorId = cursorMatch ? positiveInt(cursorMatch[2]) : null;
      const where = ['l.user_id = ?'];
      const params = [req.user.id];
      if (cursorTimestamp && cursorId) {
        where.push('(UNIX_TIMESTAMP(l.created_at) < ? OR (UNIX_TIMESTAMP(l.created_at) = ? AND l.id < ?))');
        params.push(cursorTimestamp, cursorTimestamp, cursorId);
      }
      const fetchLimit = paged ? limit + 1 : limit;
      const [rows] = await pool.query(
        `SELECT l.*, UNIX_TIMESTAMP(l.created_at) AS log_timestamp
           FROM course_ticket_transfer_logs l
          WHERE ${where.join(' AND ')}
          ORDER BY l.created_at DESC, l.id DESC
          LIMIT ?`,
        [...params, fetchLimit]
      );
      const hasMore = paged && rows.length > limit;
      const visibleRows = hasMore ? rows.slice(0, limit) : rows;
      const items = visibleRows.map((row) => toCourseTicketTransferLog(row, req.user.id));
      if (!paged) return ok(res, items);
      return ok(res, {
        items,
        meta: {
          limit,
          hasMore,
          nextCursor: hasMore && visibleRows.length
            ? `${Number(visibleRows[visibleRows.length - 1].log_timestamp)}:${Number(visibleRows[visibleRows.length - 1].id)}`
            : null,
        },
      });
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_LOGS_FAIL', error);
    }
  });

  router.post('/courses/tickets/transfers/initiate', authRequired, (req, res) => initiateCourseTicketTransfer(req, res, {
    ticketId: req.body?.ticketId ?? req.body?.ticket_id,
    mode: text(req.body?.mode, 16).toLowerCase(),
    email: req.body?.email,
  }));

  router.post('/courses/tickets/transfers/:id/accept', authRequired, async (req, res) => {
    const transferId = positiveInt(req.params.id);
    if (!transferId) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
    const idempotencyKey = courseV2.mutationKeyFromRequest(req);
    const expectedRowVersion = courseV2.rowVersionFromRequest(req);
    if (courseV2.enabled && !idempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '接受轉讓需要 Idempotency-Key', 400);
    }
    if (courseV2.enabled && !expectedRowVersion) {
      return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '接受轉讓需要票券 If-Match', 428);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const [userRows] = await conn.query(
        'SELECT id, username, email FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [req.user.id]
      );
      const recipient = userRows[0];
      if (!recipient) return rollbackFail(conn, res, 'USER_NOT_FOUND', '找不到使用者', 404);
      const operation = 'ticket.transfer.accept';
      const mutation = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { transferId, expectedRowVersion },
          resourceType: 'course_ticket_transfer',
          resourceId: transferId,
        })
        : null;
      if (mutation?.replay) {
        await conn.commit();
        return ok(res, mutation.replay, '已接受並完成課程票券轉讓');
      }
      // Always acquire user locks before transfer locks; account lifecycle
      // transactions use this order as well.
      const [rows] = await conn.query(
        "SELECT * FROM course_ticket_transfers WHERE id = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [transferId]
      );
      const transfer = rows[0];
      if (!transfer) return rollbackFail(conn, res, 'TRANSFER_NOT_FOUND', '找不到待處理的課程票券轉讓', 404);
      if (await expireLockedCourseTicketTransfer(conn, transfer)) {
        await conn.rollback();
        await pool.query(
          "UPDATE course_ticket_transfers SET status = 'expired' WHERE id = ? AND status = 'pending'",
          [transfer.id]
        );
        return fail(res, 'TRANSFER_EXPIRED', '這筆課程票券轉讓已過期', 410);
      }
      const userEmail = normalizeCourseTransferEmail(recipient.email);
      const matchesAssignedUser = String(transfer.to_user_id || '') === String(req.user.id);
      const matchesUnassignedEmail = !transfer.to_user_id && normalizeCourseTransferEmail(transfer.to_email) === userEmail;
      if (!matchesAssignedUser && !matchesUnassignedEmail) {
        return rollbackFail(conn, res, 'FORBIDDEN', '僅限被指定的帳號接受', 403);
      }
      if (String(transfer.from_user_id) === String(req.user.id)) return rollbackFail(conn, res, 'FORBIDDEN', '不可自行接受', 403);
      const completion = await completeCourseTicketTransfer(conn, transfer, recipient, {
        expectedTicketRowVersion: expectedRowVersion,
      });
      if (completion.error) return rollbackFail(conn, res, ...completion.error);
      const response = {
        transferId,
        ticketId: Number(completion.ticket.id),
        status: 'accepted',
        ...(courseV2.enabled ? { rowVersion: completion.rowVersion } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'ticket',
          id: completion.ticket.id,
        });
      }
      await conn.commit();
      return ok(res, response, '已接受並完成課程票券轉讓');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_ACCEPT_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.post('/courses/tickets/transfers/:id/decline', authRequired, async (req, res) => {
    const transferId = positiveInt(req.params.id);
    if (!transferId) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
    const idempotencyKey = courseV2.mutationKeyFromRequest(req);
    const expectedRowVersion = courseV2.rowVersionFromRequest(req);
    if (courseV2.enabled && !idempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '拒絕轉讓需要 Idempotency-Key', 400);
    }
    if (courseV2.enabled && !expectedRowVersion) {
      return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '拒絕轉讓需要票券 If-Match', 428);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const [userRows] = await conn.query(
        'SELECT id, email FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [req.user.id]
      );
      const recipient = userRows[0];
      if (!recipient) return rollbackFail(conn, res, 'USER_NOT_FOUND', '找不到使用者', 404);
      const operation = 'ticket.transfer.decline';
      const mutation = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { transferId, expectedRowVersion },
          resourceType: 'course_ticket_transfer',
          resourceId: transferId,
        })
        : null;
      if (mutation?.replay) {
        await conn.commit();
        return ok(res, mutation.replay, '已拒絕課程票券轉讓');
      }
      const [rows] = await conn.query(
        "SELECT * FROM course_ticket_transfers WHERE id = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [transferId]
      );
      const transfer = rows[0];
      if (!transfer) return rollbackFail(conn, res, 'TRANSFER_NOT_FOUND', '找不到待處理的課程票券轉讓', 404);
      if (await expireLockedCourseTicketTransfer(conn, transfer)) {
        await conn.rollback();
        await pool.query(
          "UPDATE course_ticket_transfers SET status = 'expired' WHERE id = ? AND status = 'pending'",
          [transfer.id]
        );
        return fail(res, 'TRANSFER_EXPIRED', '這筆課程票券轉讓已過期', 410);
      }
      const matchesAssignedUser = String(transfer.to_user_id || '') === String(recipient.id);
      const matchesUnassignedEmail = !transfer.to_user_id
        && normalizeCourseTransferEmail(transfer.to_email) === normalizeCourseTransferEmail(recipient.email);
      if (!matchesAssignedUser && !matchesUnassignedEmail) {
        return rollbackFail(conn, res, 'FORBIDDEN', '僅限被指定的帳號拒絕', 403);
      }
      let nextTicketRowVersion = null;
      if (courseV2.enabled) {
        const [[ticket]] = await conn.query(
          'SELECT id, row_version FROM course_tickets WHERE id = ? LIMIT 1 FOR UPDATE',
          [transfer.ticket_id]
        );
        if (!ticket) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '課程票券不存在', 404);
        if (Number(ticket.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        const [ticketUpdate] = await conn.query(
          'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ? AND row_version = ?',
          [ticket.id, expectedRowVersion]
        );
        if (!ticketUpdate.affectedRows) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        nextTicketRowVersion = Number(expectedRowVersion) + 1;
      }
      await conn.query(
        "UPDATE course_ticket_transfers SET status = 'declined' WHERE id = ? AND status = 'pending'",
        [transfer.id]
      );
      const response = {
        transferId,
        status: 'declined',
        ...(courseV2.enabled ? { rowVersion: nextTicketRowVersion } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'course_ticket_transfer',
          id: transferId,
        });
      }
      await conn.commit();
      return ok(res, response, '已拒絕課程票券轉讓');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_DECLINE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/courses/tickets/transfers/claim_code/preview', authRequired, async (req, res) => {
    const code = text(req.query?.code, 64).replace(/\s+/g, '').toUpperCase();
    if (!isCourseTicketTransferCode(code)) {
      return fail(res, 'VALIDATION_ERROR', '無效的課程票券轉讓碼', 400);
    }
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT tr.id AS transfer_id, tr.code, tr.from_user_id,
                t.id AS ticket_id, t.row_version AS ticket_row_version,
                t.expires_at, t.activation_deadline,
                COALESCE(t.product_name_snapshot, tp.name, p.name, '課程票券') AS product_name,
                sender.username AS from_username, COALESCE(tr.from_email, sender.email) AS from_email
           FROM course_ticket_transfers tr
           JOIN course_tickets t ON t.id = tr.ticket_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
           JOIN users sender ON sender.id = tr.from_user_id
          WHERE tr.code = ? AND tr.status = 'pending'
            AND tr.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)
            AND (t.expires_at IS NULL OR t.expires_at >= CURRENT_DATE())
            AND (
              t.status <> 'pending'
              OR t.activation_deadline IS NULL
              OR t.activation_deadline >= CURRENT_DATE()
            )
            AND COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) > 0
            AND t.status IN ('pending', 'active')
          LIMIT 1`,
        [code]
      );
      const transfer = rows[0];
      if (!transfer) return fail(res, 'CODE_NOT_FOUND', '無效、已過期或已處理的課程票券轉讓碼', 404);
      if (String(transfer.from_user_id) === String(req.user.id)) {
        return fail(res, 'FORBIDDEN', '不可轉讓給自己', 403);
      }
      return ok(res, {
        transferId: Number(transfer.transfer_id),
        code: transfer.code,
        ticketId: Number(transfer.ticket_id),
        ticketRowVersion: Number(transfer.ticket_row_version || 1),
        productName: transfer.product_name,
        fromUsername: transfer.from_username || '',
        fromEmail: transfer.from_email || '',
        expiresAt: transfer.expires_at || transfer.activation_deadline || null,
      });
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_TRANSFER_PREVIEW_FAIL', error);
    }
  });

  router.post('/courses/tickets/transfers/claim_code', authRequired, async (req, res) => {
    const code = text(req.body?.code, 64).replace(/\s+/g, '').toUpperCase();
    if (!isCourseTicketTransferCode(code)) return fail(res, 'VALIDATION_ERROR', '無效的課程票券轉讓碼', 400);
    const idempotencyKey = courseV2.mutationKeyFromRequest(req);
    const expectedRowVersion = courseV2.rowVersionFromRequest(req);
    if (courseV2.enabled && !idempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '領取轉讓票券需要 Idempotency-Key', 400);
    }
    if (courseV2.enabled && !expectedRowVersion) {
      return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '領取轉讓票券需要票券 If-Match', 428);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const [userRows] = await conn.query('SELECT id, username, email FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.user.id]);
      const recipient = userRows[0];
      if (!recipient) return rollbackFail(conn, res, 'USER_NOT_FOUND', '找不到使用者', 404);
      const operation = 'ticket.transfer.claim';
      const mutation = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { code, expectedRowVersion },
          resourceType: 'course_ticket_transfer',
        })
        : null;
      if (mutation?.replay) {
        await conn.commit();
        return ok(res, mutation.replay, '已完成課程票券轉讓');
      }
      const [rows] = await conn.query(
        "SELECT * FROM course_ticket_transfers WHERE code = ? AND status = 'pending' LIMIT 1 FOR UPDATE",
        [code]
      );
      const transfer = rows[0];
      if (!transfer) return rollbackFail(conn, res, 'CODE_NOT_FOUND', '無效或已處理的課程票券轉讓碼', 404);
      if (await expireLockedCourseTicketTransfer(conn, transfer)) {
        await conn.rollback();
        await pool.query(
          "UPDATE course_ticket_transfers SET status = 'expired' WHERE id = ? AND status = 'pending'",
          [transfer.id]
        );
        return fail(res, 'TRANSFER_EXPIRED', '這個課程票券轉讓碼已過期', 410);
      }
      if (String(transfer.from_user_id) === String(req.user.id)) return rollbackFail(conn, res, 'FORBIDDEN', '不可轉讓給自己', 403);
      const completion = await completeCourseTicketTransfer(conn, transfer, recipient, {
        expectedTicketRowVersion: expectedRowVersion,
      });
      if (completion.error) return rollbackFail(conn, res, ...completion.error);
      const response = {
        transferId: Number(transfer.id),
        ticketId: Number(completion.ticket.id),
        status: 'accepted',
        ...(courseV2.enabled ? { rowVersion: completion.rowVersion } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'ticket',
          id: completion.ticket.id,
        });
      }
      await conn.commit();
      return ok(res, response, '已完成課程票券轉讓');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_CLAIM_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/courses/tickets/transfers/incoming', authRequired, async (req, res) => {
    try {
      await ensureSchema();
      const [rows] = await pool.query(
        `SELECT tr.*, t.code AS ticket_code, t.row_version AS ticketRowVersion,
                t.expires_at, t.activation_deadline,
                COALESCE(t.expires_at, t.activation_deadline) AS expiry,
                COALESCE(t.product_name_snapshot, tp.name, p.name) AS type,
                COALESCE(t.product_name_snapshot, tp.name, p.name) AS product_name,
                u.username AS from_username, COALESCE(tr.from_email, u.email) AS from_email
           FROM course_ticket_transfers tr
           JOIN course_tickets t ON t.id = tr.ticket_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
           JOIN users u ON u.id = tr.from_user_id
           JOIN users recipient ON recipient.id = ?
          WHERE tr.status = 'pending'
            AND (t.expires_at IS NULL OR t.expires_at >= CURRENT_DATE())
            AND (
              t.status <> 'pending'
              OR t.activation_deadline IS NULL
              OR t.activation_deadline >= CURRENT_DATE()
            )
            AND t.status IN ('pending', 'active')
            AND COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) > 0
            AND (
              (tr.code IS NULL AND tr.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
              OR (tr.code IS NOT NULL AND tr.created_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE))
            )
            AND (tr.to_user_id = ? OR (tr.to_user_id IS NULL AND LOWER(tr.to_email) = LOWER(recipient.email)))
          ORDER BY tr.created_at DESC, tr.id DESC`,
        [req.user.id, req.user.id]
      );
      return ok(res, rows);
    } catch (error) {
      return handleError(res, 'COURSE_TICKET_INCOMING_TRANSFERS_FAIL', error);
    }
  });

  router.post('/courses/tickets/transfers/cancel_pending', authRequired, async (req, res) => {
    const ticketId = positiveInt(req.body?.ticketId ?? req.body?.ticket_id);
    if (!ticketId) return fail(res, 'VALIDATION_ERROR', '參數錯誤', 400);
    const idempotencyKey = courseV2.mutationKeyFromRequest(req);
    const expectedRowVersion = courseV2.rowVersionFromRequest(req);
    if (courseV2.enabled && !idempotencyKey) {
      return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '取消轉讓需要 Idempotency-Key', 400);
    }
    if (courseV2.enabled && !expectedRowVersion) {
      return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '取消轉讓需要票券 If-Match', 428);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const operation = 'ticket.transfer.cancel';
      const mutation = courseV2.enabled
        ? await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ticketId, expectedRowVersion },
          resourceType: 'ticket',
          resourceId: ticketId,
        })
        : null;
      if (mutation?.replay) {
        await conn.commit();
        return ok(res, mutation.replay, '已取消待處理的課程票券轉讓');
      }
      const [ticketRows] = await conn.query(
        'SELECT id, user_id, row_version FROM course_tickets WHERE id = ? LIMIT 1 FOR UPDATE',
        [ticketId]
      );
      const ticket = ticketRows[0];
      if (!ticket) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      if (String(ticket.user_id) !== String(req.user.id)) {
        return rollbackFail(conn, res, 'FORBIDDEN', '僅限持有者取消', 403);
      }
      if (courseV2.enabled && Number(ticket.row_version || 1) !== Number(expectedRowVersion)) {
        return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
      }
      const [transferUpdate] = await conn.query(
        "UPDATE course_ticket_transfers SET status = 'canceled' WHERE ticket_id = ? AND from_user_id = ? AND status = 'pending'",
        [ticketId, req.user.id]
      );
      if (!transferUpdate.affectedRows) {
        return rollbackFail(conn, res, 'TRANSFER_NOT_FOUND', '找不到待取消的課程票券轉讓', 404);
      }
      let nextRowVersion = Number(ticket.row_version || 1);
      if (courseV2.enabled) {
        const [ticketUpdate] = await conn.query(
          'UPDATE course_tickets SET row_version = row_version + 1 WHERE id = ? AND row_version = ?',
          [ticket.id, expectedRowVersion]
        );
        if (!ticketUpdate.affectedRows) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
        }
        nextRowVersion += 1;
      }
      const response = {
        ticketId,
        status: 'canceled',
        ...(courseV2.enabled ? { rowVersion: nextRowVersion } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'ticket',
          id: ticketId,
        });
      }
      await conn.commit();
      return ok(res, response, '已取消待處理的課程票券轉讓');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'COURSE_TICKET_TRANSFER_CANCEL_FAIL', error);
    } finally {
      conn.release();
    }
  });

  // Legacy clients keep the old path, but now use the same recipient-consent workflow.
  router.post('/courses/tickets/:id/transfer', authRequired, (req, res) => initiateCourseTicketTransfer(req, res, {
    ticketId: req.params.id,
    mode: 'email',
    email: req.body?.email,
  }));

  router.get('/admin/courses/overview', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      if (courseV2.enabled) {
        const globalAccess = isGlobalCourseManager(req.user);
        const scopedOwnerUserId = req.courseV2OwnerUserId || req.user.id;
        const params = globalAccess ? [] : [scopedOwnerUserId];
        const [[products], [sessions], [orders], [tickets], [bookings]] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) AS total FROM course_products
              WHERE status <> 'archived'${globalAccess ? '' : ' AND owner_user_id = ?'}`,
            params
          ),
          pool.query(
            `SELECT COUNT(*) AS total FROM course_sessions
              WHERE status = 'open' AND ends_at >= NOW()${globalAccess ? '' : ' AND owner_user_id = ?'}`,
            params
          ),
          pool.query(
            `SELECT COUNT(DISTINCT o.id) AS total
               FROM course_orders o
               LEFT JOIN course_products p ON p.id = o.product_id
               LEFT JOIN course_students student ON student.id = o.student_id
               LEFT JOIN course_order_items oi ON oi.order_id = o.id
              LEFT JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
              WHERE o.status IN ('pending', 'payment_review', 'paid')
                ${globalAccess
    ? ''
    : 'AND COALESCE(p.owner_user_id, tp.owner_user_id, student.owner_user_id) = ?'}`,
            params
          ),
          pool.query(
            `SELECT COUNT(*) AS total
               FROM course_tickets t
               LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
              LEFT JOIN course_products p ON p.id = t.product_id
              WHERE t.status IN ('pending', 'active', 'paused')
                ${globalAccess
    ? ''
    : 'AND COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) = ?'}`,
            params
          ),
          pool.query(
            `SELECT COUNT(*) AS total
               FROM course_bookings b
               JOIN course_sessions s ON s.id = b.session_id
              WHERE b.status = 'booked'${globalAccess ? '' : ' AND s.owner_user_id = ?'}`,
            params
          ),
        ]);
        return ok(res, {
          products: Number(products[0]?.total || 0),
          openSessions: Number(sessions[0]?.total || 0),
          pendingOrders: Number(orders[0]?.total || 0),
          activeTickets: Number(tickets[0]?.total || 0),
          upcomingBookings: Number(bookings[0]?.total || 0),
        });
      }
      const ownerSql = isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?';
      const relationOwnerSql = isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?';
      const ownerParams = isGlobalCourseManager(req.user) ? [] : [req.user.id];
      const [[products], [sessions], [orders], [tickets], [bookings]] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total FROM course_products WHERE status <> 'archived'${ownerSql}`, ownerParams),
        pool.query(`SELECT COUNT(*) AS total FROM course_sessions WHERE status = 'open' AND ends_at >= NOW()${ownerSql}`, ownerParams),
        pool.query(`SELECT COUNT(*) AS total FROM course_orders o JOIN course_products p ON p.id = o.product_id WHERE o.status IN ('pending', 'payment_review', 'paid')${relationOwnerSql}`, ownerParams),
        pool.query(`SELECT COUNT(*) AS total FROM course_tickets t JOIN course_products p ON p.id = t.product_id WHERE t.status IN ('pending', 'active', 'paused')${relationOwnerSql}`, ownerParams),
        pool.query(`SELECT COUNT(*) AS total FROM course_bookings b JOIN course_tickets t ON t.id = b.ticket_id JOIN course_products p ON p.id = t.product_id WHERE b.status = 'booked'${relationOwnerSql}`, ownerParams),
      ]);
      return ok(res, {
        products: Number(products[0]?.total || 0),
        openSessions: Number(sessions[0]?.total || 0),
        pendingOrders: Number(orders[0]?.total || 0),
        activeTickets: Number(tickets[0]?.total || 0),
        upcomingBookings: Number(bookings[0]?.total || 0),
      });
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_OVERVIEW_FAIL', error);
    }
  });

  router.get('/admin/courses/products', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req);
      const where = [];
      const params = [];
      appendManagerOwnerScope(req, 'p', where, params);
      if (paging.q) {
        where.push('(p.code LIKE ? OR p.name LIKE ? OR p.category LIKE ? OR provider.username LIKE ?)');
        params.push(...Array(4).fill(`%${paging.q}%`));
      }
      const category = queryText(req.query?.category, 80);
      if (category) { where.push('p.category = ?'); params.push(category); }
      const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]'], COURSE_PRODUCT_STATUSES);
      if (statuses.length) { where.push(`p.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
      const priceMin = Number(firstValue(req.query?.priceMin ?? req.query?.price_min));
      const priceMax = Number(firstValue(req.query?.priceMax ?? req.query?.price_max));
      if (Number.isFinite(priceMin) && priceMin >= 0) { where.push('p.price >= ?'); params.push(priceMin); }
      if (Number.isFinite(priceMax) && priceMax >= 0) { where.push('p.price <= ?'); params.push(priceMax); }
      const numericFilters = [
        [req.query?.classCountMin ?? req.query?.class_count_min, 'p.class_count', '>='],
        [req.query?.classCountMax ?? req.query?.class_count_max, 'p.class_count', '<='],
        [req.query?.validDaysMin ?? req.query?.valid_days_min, 'p.valid_days', '>='],
        [req.query?.validDaysMax ?? req.query?.valid_days_max, 'p.valid_days', '<='],
        [req.query?.activationDaysMin ?? req.query?.activation_days_min, 'p.activation_days', '>='],
        [req.query?.activationDaysMax ?? req.query?.activation_days_max, 'p.activation_days', '<='],
      ];
      for (const [raw, column, operator] of numericFilters) {
        const value = raw === undefined ? null : nonNegativeInt(raw, null);
        if (value !== null) { where.push(`${column} ${operator} ?`); params.push(value); }
      }
      const transferable = queryBoolean(req.query?.transferable);
      if (transferable !== null) { where.push('p.transferable = ?'); params.push(transferable ? 1 : 0); }
      const updatedFrom = queryDate(req.query?.updatedFrom ?? req.query?.updated_from);
      const updatedTo = queryDate(req.query?.updatedTo ?? req.query?.updated_to);
      if (updatedFrom) { where.push('p.updated_at >= ?'); params.push(`${updatedFrom} 00:00:00`); }
      if (updatedTo) { where.push('p.updated_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(updatedTo); }
      const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT p.*, provider.username AS provider_name
           FROM course_products p LEFT JOIN users provider ON provider.id = p.owner_user_id
          ${filterSql} ORDER BY p.sort_order ASC, p.id DESC${paging.paged ? ' LIMIT ? OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : params
      );
      const items = (await enrichCourseProductRelations(pool, rows)).map(toProduct);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM course_products p LEFT JOIN users provider ON provider.id = p.owner_user_id ${filterSql}`,
        params
      );
      const summaryWhere = [];
      const summaryParams = [];
      appendManagerOwnerScope(req, 'p', summaryWhere, summaryParams, { allowAdminFilters: false });
      const [summaryRows] = await pool.query(
        `SELECT p.status, COUNT(*) AS total FROM course_products p
          ${summaryWhere.length ? `WHERE ${summaryWhere.join(' AND ')}` : ''} GROUP BY p.status`,
        summaryParams
      );
      const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
      const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCTS_LIST_FAIL', error);
    }
  });

  router.get('/admin/courses/products/:id/cover', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const product = await findProduct(req.params.id, { manager: req });
      if (!product) return res.status(404).end();
      if (await serveCourseProductCover(res, product, { privateCache: true })) return;
      return res.status(404).end();
    } catch (error) {
      console.error('[courses] ADMIN_COURSE_PRODUCT_COVER_READ_FAIL:', error?.message || error);
      return res.status(500).end();
    }
  });

  router.post('/admin/courses/products', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '新增銷售方案需要 Idempotency-Key', 400);
      }
      const conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await conn.beginTransaction();
        await courseV2.assertMutationAllowed(conn);
        const name = text(req.body?.name, 255);
        if (!name) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請填寫銷售方案名稱', 400);
        const ownerUserId = await resolveCourseOwner(
          req,
          firstOwnField(req.body, ['ownerUserId', 'owner_user_id', 'providerUserId', 'provider_user_id']),
          conn,
          { fallback: null }
        );
        const operation = 'sales-plan.create';
        const mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, ...req.body },
          resourceType: 'shop_product',
        });
        if (mutation.replay) {
          await conn.commit();
          return ok(res, mutation.replay, '銷售方案已新增');
        }
        const links = await resolveCourseSalesPlanLinks(conn, {
          ownerUserId,
          body: req.body || {},
        });
        const primary = links.primaryTicketProduct;
        const code = text(req.body?.code, 40).toUpperCase()
          || await uniqueCode('course_products', 'CP', conn);
        const status = normalizeStatus(req.body?.status, COURSE_PRODUCT_STATUSES, 'draft');
        const requireAddonForNew = booleanFlag(
          req.body?.requireAddonForNew
            ?? req.body?.require_addon_for_new
            ?? req.body?.returningStudentOnly
            ?? req.body?.returning_student_only,
          false
        );
        const [result] = await conn.query(
          `INSERT INTO course_products
            (owner_user_id, ticket_product_id, code, name, category, summary, description,
             cover_url, price, class_count, valid_days, activation_days, transferable,
             returning_student_only, require_addon_for_new, external_purchase_url,
             status, sort_order, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            primary.id,
            code,
            name,
            text(req.body?.category, 80) || null,
            text(req.body?.summary, 500) || null,
            text(req.body?.description, 20000) || null,
            normalizeCourseCoverUrl(req.body?.coverUrl ?? req.body?.cover_url, { strict: true }),
            money(req.body?.price),
            Number(primary.class_count),
            Number(primary.valid_days),
            Number(primary.activation_days),
            Number(primary.transferable || 0),
            requireAddonForNew ? 1 : 0,
            normalizeCourseCoverUrl(
              req.body?.externalPurchaseUrl ?? req.body?.external_purchase_url,
              { strict: true }
            ),
            status,
            Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order, 10) || 0,
          ]
        );
        const productId = Number(result.insertId);
        await replaceCourseSalesPlanLinks(conn, productId, links);
        const response = {
          id: productId,
          code,
          providerUserId: ownerUserId,
          ticketProductId: Number(primary.id),
          requireAddonForNew,
          rowVersion: 1,
        };
        await courseV2.completeMutation(conn, req.user.id, operation, mutation, response, {
          type: 'shop_product',
          id: productId,
        });
        await conn.commit();
        return ok(res, response, '銷售方案已新增');
      } catch (error) {
        try { await conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_PRODUCT_CREATE_FAIL', error);
      } finally {
        conn.release();
      }
    }
    try {
      await ensureSchema();
      const name = text(req.body?.name, 255);
      if (!name) return fail(res, 'VALIDATION_ERROR', '請填寫課程商品名稱', 400);
      const code = text(req.body?.code, 40).toUpperCase() || await uniqueCode('course_products', 'CP');
      const status = normalizeStatus(req.body?.status, COURSE_PRODUCT_STATUSES, 'draft');
      const ownerUserId = await resolveCourseOwner(
        req,
        firstOwnField(req.body, ['ownerUserId', 'owner_user_id', 'providerUserId', 'provider_user_id']),
        pool,
        { fallback: null }
      );
      const [result] = await pool.query(
        `INSERT INTO course_products
          (owner_user_id, code, name, category, summary, description, cover_url, price, class_count, valid_days, activation_days, transferable, external_purchase_url, status, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownerUserId, code, name, text(req.body?.category, 80) || null, text(req.body?.summary, 500) || null,
          text(req.body?.description, 20000) || null, normalizeCourseCoverUrl(req.body?.coverUrl ?? req.body?.cover_url, { strict: true }),
          money(req.body?.price), positiveInt(req.body?.classCount ?? req.body?.class_count, 1, 999),
          positiveInt(req.body?.validDays ?? req.body?.valid_days, 120, 3650), positiveInt(req.body?.activationDays ?? req.body?.activation_days, 120, 3650),
          booleanFlag(req.body?.transferable, false) ? 1 : 0,
          normalizeCourseCoverUrl(req.body?.externalPurchaseUrl ?? req.body?.external_purchase_url, { strict: true }),
          status, Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order, 10) || 0,
        ]
      );
      return ok(res, { id: Number(result.insertId), code, providerUserId: ownerUserId }, '課程商品已新增');
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_PRODUCT_CREATE_FAIL', error);
    }
  });

  router.patch('/admin/courses/products/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '更新銷售方案需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '更新銷售方案需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      let previousCoverPath = null;
      let removePreviousCover = false;
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const product = await findProduct(req.params.id, {
          conn: v2Conn,
          manager: req,
          forUpdate: true,
        });
        if (!product) {
          return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到銷售方案', 404);
        }
        const operation = 'sales-plan.update';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { productId: Number(product.id), expectedRowVersion, ...req.body },
          resourceType: 'shop_product',
          resourceId: product.id,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '銷售方案已更新');
        }
        if (Number(product.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const links = await resolveCourseSalesPlanLinks(v2Conn, {
          ownerUserId: product.owner_user_id || null,
          body: {
            ...(req.body || {}),
            ticketProductId: req.body?.ticketProductId
              ?? req.body?.ticket_product_id
              ?? product.ticket_product_id,
          },
          productId: product.id,
        });
        const primary = links.primaryTicketProduct;
        const name = text(req.body?.name ?? product.name, 255);
        if (!name) return rollbackFail(v2Conn, res, 'VALIDATION_ERROR', '請填寫銷售方案名稱', 400);
        const hasCoverUrlInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'coverUrl')
          || Object.prototype.hasOwnProperty.call(req.body || {}, 'cover_url');
        const coverUrl = hasCoverUrlInput
          ? normalizeCourseCoverUrl(req.body?.coverUrl ?? req.body?.cover_url, { strict: true })
          : (product.cover_url || null);
        const useExternalCover = Boolean(coverUrl);
        previousCoverPath = product.cover_path
          ? storage.toSafeRelativePath(product.cover_path)
          : null;
        removePreviousCover = useExternalCover && Boolean(previousCoverPath);
        const requireAddonForNew = booleanFlag(
          req.body?.requireAddonForNew
            ?? req.body?.require_addon_for_new
            ?? req.body?.returningStudentOnly
            ?? req.body?.returning_student_only,
          Boolean(Number(product.require_addon_for_new || 0))
        );
        const [updated] = await v2Conn.query(
          `UPDATE course_products
              SET ticket_product_id = ?, name = ?, category = ?, summary = ?, description = ?,
                  cover_url = ?, cover_type = ?, cover_path = ?, price = ?, class_count = ?,
                  valid_days = ?, activation_days = ?, transferable = ?,
                  returning_student_only = 0, require_addon_for_new = ?,
                  external_purchase_url = ?, status = ?, sort_order = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            primary.id,
            name,
            text(req.body?.category ?? product.category, 80) || null,
            text(req.body?.summary ?? product.summary, 500) || null,
            text(req.body?.description ?? product.description, 20000) || null,
            coverUrl,
            useExternalCover ? null : product.cover_type,
            useExternalCover ? null : product.cover_path,
            money(req.body?.price, Number(product.price)),
            Number(primary.class_count),
            Number(primary.valid_days),
            Number(primary.activation_days),
            Number(primary.transferable || 0),
            requireAddonForNew ? 1 : 0,
            normalizeCourseCoverUrl(
              req.body?.externalPurchaseUrl
                ?? req.body?.external_purchase_url
                ?? product.external_purchase_url,
              { strict: true }
            ),
            normalizeStatus(
              req.body?.status ?? product.status,
              COURSE_PRODUCT_STATUSES,
              product.status || 'draft'
            ),
            Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order ?? product.sort_order, 10) || 0,
            product.id,
            expectedRowVersion,
          ]
        );
        if (!updated.affectedRows) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        await replaceCourseSalesPlanLinks(v2Conn, product.id, links);
        const response = {
          id: Number(product.id),
          ticketProductId: Number(primary.id),
          requireAddonForNew,
          rowVersion: Number(expectedRowVersion) + 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'shop_product',
          id: product.id,
        });
        await v2Conn.commit();
        if (removePreviousCover) await storage.deleteFile(previousCoverPath).catch(() => {});
        return ok(res, response, '銷售方案已更新');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_PRODUCT_UPDATE_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const product = await findProduct(req.params.id, { conn, manager: req, forUpdate: true });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const name = text(req.body?.name ?? product.name, 255);
      const status = normalizeStatus(req.body?.status ?? product.status, COURSE_PRODUCT_STATUSES, product.status || 'draft');
      const hasCoverUrlInput = Object.prototype.hasOwnProperty.call(req.body || {}, 'coverUrl')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'cover_url');
      const coverUrl = hasCoverUrlInput
        ? normalizeCourseCoverUrl(req.body?.coverUrl ?? req.body?.cover_url, { strict: true })
        : (product.cover_url || null);
      const useExternalCover = Boolean(coverUrl);
      const nextCoverType = useExternalCover ? null : (product.cover_type || null);
      const nextCoverPath = useExternalCover ? null : (product.cover_path || null);
      const [result] = await conn.query(
        `UPDATE course_products SET name = ?, category = ?, summary = ?, description = ?, cover_url = ?, cover_type = ?, cover_path = ?, price = ?, class_count = ?,
          valid_days = ?, activation_days = ?, transferable = ?, external_purchase_url = ?, status = ?, sort_order = ?
          WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'}`,
        [
          name, text(req.body?.category ?? product.category, 80) || null, text(req.body?.summary ?? product.summary, 500) || null,
          text(req.body?.description ?? product.description, 20000) || null, coverUrl, nextCoverType, nextCoverPath,
          money(req.body?.price, Number(product.price)), positiveInt(req.body?.classCount ?? req.body?.class_count, Number(product.class_count), 999),
          positiveInt(req.body?.validDays ?? req.body?.valid_days, Number(product.valid_days), 3650),
          positiveInt(req.body?.activationDays ?? req.body?.activation_days, Number(product.activation_days), 3650),
          booleanFlag(req.body?.transferable, Boolean(Number(product.transferable))) ? 1 : 0,
          normalizeCourseCoverUrl(req.body?.externalPurchaseUrl ?? req.body?.external_purchase_url ?? product.external_purchase_url, { strict: true }),
          status, Number.parseInt(req.body?.sortOrder ?? req.body?.sort_order ?? product.sort_order, 10) || 0, product.id,
          ...(!isGlobalCourseManager(req.user) ? [req.user.id] : []),
        ]
      );
      if (!result.affectedRows) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '課程所有權已變更，請重新載入', 404);
      await conn.commit();
      if (useExternalCover && product.cover_path) {
        const previousPath = storage.toSafeRelativePath(product.cover_path);
        if (previousPath) await storage.deleteFile(previousPath).catch(() => {});
      }
      return ok(res, null, '課程商品已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_PRODUCT_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.post('/admin/courses/products/:id/cover_json', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '更新銷售方案封面需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '更新銷售方案封面需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      let nextPath = null;
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const product = await findProduct(req.params.id, {
          conn: v2Conn,
          manager: req,
          forUpdate: true,
        });
        if (!product) return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到銷售方案', 404);
        const { buffer, mime } = parseImagePayload(req.body || {});
        const operation = 'sales-plan.cover-upload';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: {
            productId: Number(product.id),
            expectedRowVersion,
            mime,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          },
          resourceType: 'shop_product',
          resourceId: product.id,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '課程封面已更新');
        }
        if (Number(product.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const extension = storage.mimeToExtension(mime);
        nextPath = buildCourseProductCoverStoragePath(product.id, extension, storage);
        const previousPath = product.cover_path
          ? storage.toSafeRelativePath(product.cover_path)
          : null;
        await storage.writeBuffer(nextPath, buffer, { mode: 0o600 });
        const [updated] = await v2Conn.query(
          `UPDATE course_products
              SET cover_url = NULL, cover_type = ?, cover_path = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            mime,
            storage.normalizeRelativePath(nextPath),
            product.id,
            expectedRowVersion,
          ]
        );
        if (!updated.affectedRows) {
          await storage.deleteFile(nextPath).catch(() => {});
          nextPath = null;
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const response = {
          id: Number(product.id),
          size: buffer.length,
          type: mime,
          hasCover: true,
          rowVersion: Number(expectedRowVersion) + 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'shop_product',
          id: product.id,
        });
        await v2Conn.commit();
        if (previousPath && previousPath !== nextPath) {
          await storage.deleteFile(previousPath).catch(() => {});
        }
        return ok(res, response, '課程封面已更新');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        if (nextPath) await storage.deleteFile(nextPath).catch(() => {});
        const status = error?.status || error?.statusCode;
        if (status) return fail(res, error.code || 'VALIDATION_ERROR', error.message, status);
        return handleError(res, 'ADMIN_COURSE_PRODUCT_COVER_UPLOAD_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    let nextPath = null;
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const product = await findProduct(req.params.id, { conn, manager: req, forUpdate: true });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const { buffer, mime } = parseImagePayload(req.body || {});
      const extension = storage.mimeToExtension(mime);
      nextPath = buildCourseProductCoverStoragePath(product.id, extension, storage);
      const previousPath = product.cover_path ? storage.toSafeRelativePath(product.cover_path) : null;
      await storage.writeBuffer(nextPath, buffer, { mode: 0o600 });
      try {
        const [result] = await conn.query(
          `UPDATE course_products SET cover_url = NULL, cover_type = ?, cover_path = ?
            WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'}`,
          [mime, storage.normalizeRelativePath(nextPath), product.id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
        );
        if (!result.affectedRows) {
          await storage.deleteFile(nextPath).catch(() => {});
          return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '課程所有權已變更，請重新載入', 404);
        }
      } catch (error) {
        await storage.deleteFile(nextPath).catch(() => {});
        throw error;
      }
      await conn.commit();
      if (previousPath && previousPath !== nextPath) await storage.deleteFile(previousPath).catch(() => {});
      return ok(res, {
        id: product.id,
        size: buffer.length,
        type: mime,
        hasCover: true,
      }, '課程封面已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      if (nextPath) await storage.deleteFile(nextPath).catch(() => {});
      const status = error?.status || error?.statusCode;
      if (status) return fail(res, error.code || 'VALIDATION_ERROR', error.message, status);
      return handleError(res, 'ADMIN_COURSE_PRODUCT_COVER_UPLOAD_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.delete('/admin/courses/products/:id/cover', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '刪除銷售方案封面需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '刪除銷售方案封面需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const product = await findProduct(req.params.id, {
          conn: v2Conn,
          manager: req,
          forUpdate: true,
        });
        if (!product) return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到銷售方案', 404);
        const operation = 'sales-plan.cover-delete';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { productId: Number(product.id), expectedRowVersion },
          resourceType: 'shop_product',
          resourceId: product.id,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '課程封面已刪除');
        }
        if (Number(product.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const coverPath = product.cover_path
          ? storage.toSafeRelativePath(product.cover_path)
          : null;
        const [updated] = await v2Conn.query(
          `UPDATE course_products
              SET cover_url = NULL, cover_type = NULL, cover_path = NULL,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [product.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const response = {
          id: Number(product.id),
          hasCover: false,
          rowVersion: Number(expectedRowVersion) + 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'shop_product',
          id: product.id,
        });
        await v2Conn.commit();
        if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
        return ok(res, response, '課程封面已刪除');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_PRODUCT_COVER_DELETE_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const product = await findProduct(req.params.id, { conn, manager: req, forUpdate: true });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const coverPath = product.cover_path ? storage.toSafeRelativePath(product.cover_path) : null;
      const [result] = await conn.query(
        `UPDATE course_products SET cover_url = NULL, cover_type = NULL, cover_path = NULL
          WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'}`,
        [product.id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      if (!result.affectedRows) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '課程所有權已變更，請重新載入', 404);
      await conn.commit();
      if (coverPath) await storage.deleteFile(coverPath).catch(() => {});
      return ok(res, null, '課程封面已刪除');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_PRODUCT_COVER_DELETE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.delete('/admin/courses/products/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '封存銷售方案需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '封存銷售方案需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const product = await findProduct(req.params.id, {
          conn: v2Conn,
          manager: req,
          forUpdate: true,
        });
        if (!product) return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到銷售方案', 404);
        const operation = 'sales-plan.archive';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { productId: Number(product.id), expectedRowVersion },
          resourceType: 'shop_product',
          resourceId: product.id,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '銷售方案已封存');
        }
        if (Number(product.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const [updated] = await v2Conn.query(
          `UPDATE course_products
              SET status = 'archived', row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [product.id, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '銷售方案已變更，請重新載入', 409);
        }
        const response = {
          id: Number(product.id),
          status: 'archived',
          rowVersion: Number(expectedRowVersion) + 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'shop_product',
          id: product.id,
        });
        await v2Conn.commit();
        return ok(res, response, '銷售方案已封存');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_PRODUCT_ARCHIVE_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const product = await findProduct(req.params.id, { conn, manager: req, forUpdate: true });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const [result] = await conn.query(
        `UPDATE course_products SET status = 'archived'
          WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'}`,
        [product.id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      if (!result.affectedRows && product.status !== 'archived') {
        return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '課程所有權已變更，請重新載入', 404);
      }
      await conn.commit();
      return ok(res, null, '課程商品已封存');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_PRODUCT_ARCHIVE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.patch('/admin/courses/products/:id/owner', courseManagerRequired, async (req, res) => {
    if (!isGlobalCourseManager(req.user)) return fail(res, 'FORBIDDEN', '僅限管理員轉移課程所有權', 403);
    if (courseV2.enabled) {
      return fail(
        res,
        'COURSE_V2_OWNER_TRANSFER_UNSUPPORTED',
        '正規化銷售方案不可跨租戶轉移；請在目標租戶重建方案、票券產品與核銷情境',
        409
      );
    }
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'ownerUserId')
      && !Object.prototype.hasOwnProperty.call(req.body || {}, 'owner_user_id')) {
      return fail(res, 'VALIDATION_ERROR', '請指定服務商或平台課程', 400);
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const product = await findProduct(req.params.id, { conn, forUpdate: true });
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到課程商品', 404);
      const ownerUserId = await resolveCourseOwner(
        req,
        firstOwnField(req.body, ['ownerUserId', 'owner_user_id']),
        conn,
        { fallback: product.owner_user_id || null }
      );
      await conn.query('UPDATE course_products SET owner_user_id = ? WHERE id = ?', [ownerUserId, product.id]);
      const [sessionResult] = await conn.query(
        'UPDATE course_sessions SET owner_user_id = ? WHERE product_id = ?',
        [ownerUserId, product.id]
      );
      await conn.commit();
      return ok(res, {
        id: Number(product.id),
        providerUserId: ownerUserId,
        movedSessions: Number(sessionResult.affectedRows || 0),
      }, '課程所有權已轉移');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_OWNER_TRANSFER_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/sessions', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req);
      const where = [];
      const params = [];
      appendManagerOwnerScope(req, 's', where, params);
      if (paging.q) {
        where.push('(s.code LIKE ? OR s.title LIKE ? OR s.location LIKE ? OR p.name LIKE ? OR COALESCE(s.coach_name, coach.username, \'\') LIKE ? OR provider.username LIKE ?)');
        params.push(...Array(6).fill(`%${paging.q}%`));
      }
      const productId = positiveInt(req.query?.productId ?? req.query?.product_id);
      if (productId) { where.push('s.product_id = ?'); params.push(productId); }
      const productQuery = queryText(req.query?.product, 255);
      const coachQuery = queryText(req.query?.coach, 255);
      const locationQuery = queryText(req.query?.location, 255);
      if (productQuery) { where.push('p.name LIKE ?'); params.push(`%${productQuery}%`); }
      if (coachQuery) { where.push("COALESCE(s.coach_name, coach.username, '') LIKE ?"); params.push(`%${coachQuery}%`); }
      if (locationQuery) { where.push('s.location LIKE ?'); params.push(`%${locationQuery}%`); }
      const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]'], COURSE_SESSION_STATUSES);
      if (statuses.length) { where.push(`s.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
      const startsFrom = queryDate(req.query?.startsFrom ?? req.query?.starts_from);
      const startsTo = queryDate(req.query?.startsTo ?? req.query?.starts_to);
      if (startsFrom) { where.push('s.starts_at >= ?'); params.push(`${startsFrom} 00:00:00`); }
      if (startsTo) { where.push('s.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(startsTo); }
      const bookedCountSql = "(SELECT COUNT(*) FROM course_bookings bx WHERE bx.session_id = s.id AND bx.status IN ('booked','attended'))";
      if (queryText(req.query?.availability, 20).toLowerCase() === 'available') where.push(`(s.capacity = 0 OR ${bookedCountSql} < s.capacity)`);
      if (queryText(req.query?.availability, 20).toLowerCase() === 'full') where.push(`(s.capacity > 0 AND ${bookedCountSql} >= s.capacity)`);
      const full = queryBoolean(req.query?.full);
      if (full === true) where.push(`(s.capacity > 0 AND ${bookedCountSql} >= s.capacity)`);
      if (full === false) where.push(`(s.capacity = 0 OR ${bookedCountSql} < s.capacity)`);
      const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT s.*, p.name AS product_name, scenario.name AS scenario_name,
                COALESCE(s.coach_name, coach.username, '') AS coach_name,
                provider.username AS provider_name, ${bookedCountSql} AS booked_count
           FROM course_sessions s
           LEFT JOIN course_products p ON p.id = s.product_id
           LEFT JOIN course_redeem_scenarios scenario ON scenario.id = s.scenario_id
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = s.owner_user_id
          ${filterSql}
          ORDER BY s.starts_at DESC, s.id DESC${paging.paged ? ' LIMIT ? OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : params
      );
      const items = rows.map(toSession);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM course_sessions s
          LEFT JOIN course_products p ON p.id = s.product_id
          LEFT JOIN users coach ON coach.id = s.coach_user_id
          LEFT JOIN users provider ON provider.id = s.owner_user_id ${filterSql}`,
        params
      );
      const summaryWhere = [];
      const summaryParams = [];
      appendManagerOwnerScope(req, 's', summaryWhere, summaryParams, { allowAdminFilters: false });
      const [summaryRows] = await pool.query(
        `SELECT s.status, COUNT(*) AS total FROM course_sessions s
          ${summaryWhere.length ? `WHERE ${summaryWhere.join(' AND ')}` : ''} GROUP BY s.status`,
        summaryParams
      );
      const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
      const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_SESSIONS_LIST_FAIL', error);
    }
  });

  router.post('/admin/courses/sessions', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '新增場次需要 Idempotency-Key', 400);
      }
      const v2Conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const title = text(req.body?.title, 255);
        const startsAt = mysqlTaipeiDateTime(req.body?.startsAt ?? req.body?.starts_at);
        const endsAt = mysqlTaipeiDateTime(req.body?.endsAt ?? req.body?.ends_at);
        if (
          !title
          || !startsAt
          || !endsAt
          || taipeiDateTimeMs(endsAt) <= taipeiDateTimeMs(startsAt)
        ) {
          return rollbackFail(v2Conn, res, 'VALIDATION_ERROR', '請填寫正確的場次名稱與台灣時間起訖', 400);
        }
        const productId = positiveInt(req.body?.productId ?? req.body?.product_id);
        let ownerUserId;
        if (productId) {
          const product = await findProduct(productId, {
            conn: v2Conn,
            manager: req,
            forUpdate: true,
          });
          if (!product) return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可使用的銷售方案', 404);
          ownerUserId = product.owner_user_id || null;
        } else {
          ownerUserId = await resolveCourseOwner(
            req,
            firstOwnField(req.body, ['ownerUserId', 'owner_user_id', 'providerUserId', 'provider_user_id']),
            v2Conn,
            { fallback: null }
          );
        }
        const operation = 'session.create';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { ownerUserId, productId, ...req.body },
          resourceType: 'session',
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '課程場次已新增');
        }
        const references = await resolveCourseSessionReferences(v2Conn, {
          ownerUserId,
          scenarioId: req.body?.scenarioId ?? req.body?.scenario_id,
          coachProfileId: req.body?.coachProfileId ?? req.body?.coach_profile_id,
        });
        const settingsSnapshot = courseSettingsSnapshot(
          await courseV2.loadSettings(v2Conn, ownerUserId)
        );
        const code = text(req.body?.code, 40).toUpperCase()
          || await uniqueCode('course_sessions', 'CS', v2Conn);
        const [result] = await v2Conn.query(
          `INSERT INTO course_sessions
            (owner_user_id, code, product_id, scenario_id, coach_profile_id,
             title, coach_user_id, coach_name, location, starts_at, ends_at,
             booking_open_at, booking_close_at, booking_open_minutes_before,
             booking_close_minutes_before, cancel_close_minutes_before,
             redeem_open_at, redeem_close_at, redeem_open_minutes_before,
             redeem_close_minutes_after, capacity, notes, settings_snapshot_json,
             status, row_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            ownerUserId,
            code,
            productId,
            references.scenarioId,
            references.coachProfileId,
            title,
            references.coachUserId,
            text(req.body?.coachName ?? req.body?.coach_name, 255)
              || references.coachName,
            text(req.body?.location, 255) || null,
            startsAt,
            endsAt,
            mysqlTaipeiDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at),
            mysqlTaipeiDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at),
            req.body?.bookingOpenMinutesBefore ?? req.body?.booking_open_minutes_before ?? null,
            req.body?.bookingCloseMinutesBefore ?? req.body?.booking_close_minutes_before ?? null,
            req.body?.cancelCloseMinutesBefore ?? req.body?.cancel_close_minutes_before ?? null,
            mysqlTaipeiDateTime(req.body?.redeemOpenAt ?? req.body?.redeem_open_at),
            mysqlTaipeiDateTime(req.body?.redeemCloseAt ?? req.body?.redeem_close_at),
            req.body?.redeemOpenMinutesBefore ?? req.body?.redeem_open_minutes_before ?? null,
            req.body?.redeemCloseMinutesAfter ?? req.body?.redeem_close_minutes_after ?? null,
            positiveInt(req.body?.capacity, 20, 9999),
            text(req.body?.notes, 5000) || null,
            JSON.stringify(settingsSnapshot),
            normalizeStatus(req.body?.status, COURSE_SESSION_STATUSES, 'draft'),
          ]
        );
        const response = {
          id: Number(result.insertId),
          code,
          providerUserId: ownerUserId,
          scenarioId: references.scenarioId,
          coachProfileId: references.coachProfileId,
          settingsSnapshot,
          rowVersion: 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'session',
          id: result.insertId,
        });
        await v2Conn.commit();
        return ok(res, response, '課程場次已新增');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_SESSION_CREATE_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const title = text(req.body?.title, 255);
      const startsAt = mysqlDateTime(req.body?.startsAt ?? req.body?.starts_at);
      const endsAt = mysqlDateTime(req.body?.endsAt ?? req.body?.ends_at);
      if (!title || !startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return rollbackFail(conn, res, 'VALIDATION_ERROR', '請填寫正確的場次名稱與起訖時間', 400);
      const code = text(req.body?.code, 40).toUpperCase() || await uniqueCode('course_sessions', 'CS', conn);
      const productId = positiveInt(req.body?.productId ?? req.body?.product_id);
      let ownerUserId;
      if (productId) {
        const product = await findProduct(productId, { conn, manager: req, forUpdate: true });
        if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可使用的課程商品', 404);
        ownerUserId = product.owner_user_id || null;
        const requestedOwner = firstOwnField(req.body, ['ownerUserId', 'owner_user_id']);
        if (isGlobalCourseManager(req.user) && requestedOwner !== undefined
          && String(text(requestedOwner, 36) || '') !== String(ownerUserId || '')) {
          return rollbackFail(conn, res, 'COURSE_OWNER_MISMATCH', '場次與課程商品必須屬於同一服務商', 409);
        }
      } else {
        ownerUserId = await resolveCourseOwner(
          req,
          firstOwnField(req.body, ['ownerUserId', 'owner_user_id', 'providerUserId', 'provider_user_id']),
          conn,
          { fallback: null }
        );
      }
      const requestedCoachUserId = text(req.body?.coachUserId ?? req.body?.coach_user_id, 36) || null;
      const coachUserId = requestedCoachUserId || (!isGlobalCourseManager(req.user) ? String(req.user.id) : null);
      const [result] = await conn.query(
        `INSERT INTO course_sessions
          (owner_user_id, code, product_id, title, coach_user_id, coach_name, location, starts_at, ends_at, booking_open_at, booking_close_at, capacity, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownerUserId, code, productId, title, coachUserId,
          text(req.body?.coachName ?? req.body?.coach_name, 255) || null, text(req.body?.location, 255) || null,
          startsAt, endsAt, mysqlDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at),
          mysqlDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at), positiveInt(req.body?.capacity, 20, 9999),
          text(req.body?.notes, 5000) || null, normalizeStatus(req.body?.status, COURSE_SESSION_STATUSES, 'draft'),
        ]
      );
      await conn.commit();
      return ok(res, { id: Number(result.insertId), code, providerUserId: ownerUserId }, '課程場次已新增');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_SESSION_CREATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.patch('/admin/courses/sessions/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '更新場次需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '更新場次需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const sessionId = positiveInt(req.params.id);
        const scopeSql = isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?';
        const scopeParams = isGlobalCourseManager(req.user)
          ? [sessionId]
          : [sessionId, req.courseV2OwnerUserId || req.user.id];
        const [sessionRows] = await v2Conn.query(
          `SELECT * FROM course_sessions
            WHERE id = ?${scopeSql} LIMIT 1 FOR UPDATE`,
          scopeParams
        );
        const current = sessionRows[0];
        if (!current) return rollbackFail(v2Conn, res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
        const operation = 'session.update';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { sessionId, expectedRowVersion, ...req.body },
          resourceType: 'session',
          resourceId: sessionId,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '課程場次已更新');
        }
        if (Number(current.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        }
        const productField = firstOwnField(req.body, ['productId', 'product_id']);
        const nextProductId = productField === undefined
          ? positiveInt(current.product_id)
          : positiveInt(productField);
        let ownerUserId = current.owner_user_id || null;
        if (nextProductId) {
          const product = await findProduct(nextProductId, {
            conn: v2Conn,
            manager: req,
            forUpdate: true,
          });
          if (!product) return rollbackFail(v2Conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可使用的銷售方案', 404);
          ownerUserId = product.owner_user_id || null;
        } else if (isGlobalCourseManager(req.user)) {
          const ownerField = firstOwnField(req.body, ['ownerUserId', 'owner_user_id']);
          if (ownerField !== undefined) {
            ownerUserId = await resolveCourseOwner(req, ownerField, v2Conn, { fallback: ownerUserId });
          }
        }
        const scenarioField = firstOwnField(req.body, ['scenarioId', 'scenario_id']);
        const coachProfileField = firstOwnField(req.body, ['coachProfileId', 'coach_profile_id']);
        const references = await resolveCourseSessionReferences(v2Conn, {
          ownerUserId,
          scenarioId: scenarioField === undefined ? current.scenario_id : scenarioField,
          coachProfileId: coachProfileField === undefined ? current.coach_profile_id : coachProfileField,
        });
        const startsField = firstOwnField(req.body, ['startsAt', 'starts_at']);
        const endsField = firstOwnField(req.body, ['endsAt', 'ends_at']);
        const startsAt = mysqlTaipeiDateTime(startsField === undefined ? current.starts_at : startsField);
        const endsAt = mysqlTaipeiDateTime(endsField === undefined ? current.ends_at : endsField);
        if (
          !startsAt
          || !endsAt
          || taipeiDateTimeMs(endsAt) <= taipeiDateTimeMs(startsAt)
        ) {
          return rollbackFail(v2Conn, res, 'VALIDATION_ERROR', '場次結束時間需晚於開始時間', 400);
        }
        const valueOrCurrent = (keys, currentValue) => {
          const value = firstOwnField(req.body, keys);
          return value === undefined ? currentValue : value;
        };
        const refreshSettings = booleanFlag(
          req.body?.refreshSettingsSnapshot ?? req.body?.refresh_settings_snapshot,
          false
        );
        const settingsSnapshot = refreshSettings || !current.settings_snapshot_json
          ? courseSettingsSnapshot(await courseV2.loadSettings(v2Conn, ownerUserId))
          : safeJsonObject(current.settings_snapshot_json);
        const title = text(req.body?.title ?? current.title, 255);
        if (!title) return rollbackFail(v2Conn, res, 'VALIDATION_ERROR', '請填寫場次名稱', 400);
        const nextStatus = normalizeStatus(
          req.body?.status ?? current.status,
          COURSE_SESSION_STATUSES,
          current.status
        );
        if (nextStatus === 'cancelled' && current.status !== 'cancelled') {
          return rollbackFail(
            v2Conn,
            res,
            'COURSE_SESSION_CANCEL_COMMAND_REQUIRED',
            '取消場次必須使用取消命令，才能同步釋放預約與保留堂數',
            409
          );
        }
        const [updated] = await v2Conn.query(
          `UPDATE course_sessions
              SET owner_user_id = ?, product_id = ?, scenario_id = ?, coach_profile_id = ?,
                  title = ?, coach_user_id = ?, coach_name = ?, location = ?,
                  starts_at = ?, ends_at = ?, booking_open_at = ?, booking_close_at = ?,
                  booking_open_minutes_before = ?, booking_close_minutes_before = ?,
                  cancel_close_minutes_before = ?, redeem_open_at = ?, redeem_close_at = ?,
                  redeem_open_minutes_before = ?, redeem_close_minutes_after = ?,
                  capacity = ?, notes = ?, settings_snapshot_json = ?, status = ?,
                  row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [
            ownerUserId,
            nextProductId,
            references.scenarioId,
            references.coachProfileId,
            title,
            references.coachUserId,
            text(req.body?.coachName ?? req.body?.coach_name, 255)
              || references.coachName
              || (coachProfileField === undefined ? current.coach_name : null),
            text(req.body?.location ?? current.location, 255) || null,
            startsAt,
            endsAt,
            mysqlTaipeiDateTime(valueOrCurrent(['bookingOpenAt', 'booking_open_at'], current.booking_open_at)),
            mysqlTaipeiDateTime(valueOrCurrent(['bookingCloseAt', 'booking_close_at'], current.booking_close_at)),
            valueOrCurrent(
              ['bookingOpenMinutesBefore', 'booking_open_minutes_before'],
              current.booking_open_minutes_before
            ),
            valueOrCurrent(
              ['bookingCloseMinutesBefore', 'booking_close_minutes_before'],
              current.booking_close_minutes_before
            ),
            valueOrCurrent(
              ['cancelCloseMinutesBefore', 'cancel_close_minutes_before'],
              current.cancel_close_minutes_before
            ),
            mysqlTaipeiDateTime(valueOrCurrent(['redeemOpenAt', 'redeem_open_at'], current.redeem_open_at)),
            mysqlTaipeiDateTime(valueOrCurrent(['redeemCloseAt', 'redeem_close_at'], current.redeem_close_at)),
            valueOrCurrent(
              ['redeemOpenMinutesBefore', 'redeem_open_minutes_before'],
              current.redeem_open_minutes_before
            ),
            valueOrCurrent(
              ['redeemCloseMinutesAfter', 'redeem_close_minutes_after'],
              current.redeem_close_minutes_after
            ),
            positiveInt(req.body?.capacity, Number(current.capacity), 9999),
            text(req.body?.notes ?? current.notes, 5000) || null,
            JSON.stringify(settingsSnapshot),
            nextStatus,
            sessionId,
            expectedRowVersion,
          ]
        );
        if (!updated.affectedRows) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        }
        const response = {
          id: sessionId,
          providerUserId: ownerUserId,
          scenarioId: references.scenarioId,
          coachProfileId: references.coachProfileId,
          settingsSnapshot,
          rowVersion: Number(expectedRowVersion) + 1,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'session',
          id: sessionId,
        });
        await v2Conn.commit();
        return ok(res, response, '課程場次已更新');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_SESSION_UPDATE_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const id = positiveInt(req.params.id);
      const [rows] = await conn.query(
        `SELECT * FROM course_sessions WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'} LIMIT 1 FOR UPDATE`,
        [id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      const current = rows[0];
      if (!current) return rollbackFail(conn, res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      const startsAt = mysqlDateTime(req.body?.startsAt ?? req.body?.starts_at ?? current.starts_at);
      const endsAt = mysqlDateTime(req.body?.endsAt ?? req.body?.ends_at ?? current.ends_at);
      if (!startsAt || !endsAt || new Date(endsAt).getTime() <= new Date(startsAt).getTime()) return rollbackFail(conn, res, 'VALIDATION_ERROR', '場次結束時間需晚於開始時間', 400);
      const hasProductId = Object.prototype.hasOwnProperty.call(req.body || {}, 'productId')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'product_id');
      const nextProductId = hasProductId
        ? positiveInt(req.body?.productId ?? req.body?.product_id, null)
        : current.product_id;
      const globalAccess = isGlobalCourseManager(req.user);
      let nextOwnerUserId = current.owner_user_id || null;
      if (nextProductId) {
        const product = await findProduct(nextProductId, { conn, manager: req, forUpdate: true });
        if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '找不到可使用的課程商品', 404);
        nextOwnerUserId = product.owner_user_id || null;
        const requestedOwner = firstOwnField(req.body, ['ownerUserId', 'owner_user_id']);
        if (globalAccess && requestedOwner !== undefined
          && String(text(requestedOwner, 36) || '') !== String(nextOwnerUserId || '')) {
          return rollbackFail(conn, res, 'COURSE_OWNER_MISMATCH', '場次與課程商品必須屬於同一服務商', 409);
        }
      } else if (globalAccess && (Object.prototype.hasOwnProperty.call(req.body || {}, 'ownerUserId')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'owner_user_id'))) {
        nextOwnerUserId = await resolveCourseOwner(
          req,
          firstOwnField(req.body, ['ownerUserId', 'owner_user_id']),
          conn,
          { fallback: nextOwnerUserId }
        );
      }
      const requestedCoachUserId = text(req.body?.coachUserId ?? req.body?.coach_user_id ?? current.coach_user_id, 36) || null;
      const coachUserId = requestedCoachUserId;
      const updateParams = [
        nextOwnerUserId, nextProductId, text(req.body?.title ?? current.title, 255),
        coachUserId,
        text(req.body?.coachName ?? req.body?.coach_name ?? current.coach_name, 255) || null,
        text(req.body?.location ?? current.location, 255) || null, startsAt, endsAt,
        mysqlDateTime(req.body?.bookingOpenAt ?? req.body?.booking_open_at ?? current.booking_open_at),
        mysqlDateTime(req.body?.bookingCloseAt ?? req.body?.booking_close_at ?? current.booking_close_at),
        positiveInt(req.body?.capacity, Number(current.capacity), 9999), text(req.body?.notes ?? current.notes, 5000) || null,
        normalizeStatus(req.body?.status ?? current.status, COURSE_SESSION_STATUSES, current.status), id,
      ];
      if (!globalAccess) updateParams.push(req.user.id);
      const [result] = await conn.query(
        `UPDATE course_sessions SET owner_user_id = ?, product_id = ?, title = ?, coach_user_id = ?, coach_name = ?, location = ?, starts_at = ?, ends_at = ?,
          booking_open_at = ?, booking_close_at = ?, capacity = ?, notes = ?, status = ?
          WHERE id = ?${globalAccess ? '' : ' AND owner_user_id = ?'}`,
        updateParams
      );
      if (!globalAccess && !result.affectedRows) {
        const [latestRows] = await conn.query('SELECT owner_user_id FROM course_sessions WHERE id = ? LIMIT 1', [id]);
        if (!latestRows.length) return rollbackFail(conn, res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
        if (String(latestRows[0].owner_user_id || '') !== String(req.user.id)) {
          return rollbackFail(conn, res, 'COURSE_SESSION_UPDATE_CONFLICT', '場次負責人已變更，請重新載入', 409);
        }
      }
      await conn.commit();
      return ok(res, null, '課程場次已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_SESSION_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.delete('/admin/courses/sessions/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const idempotencyKey = courseV2.mutationKeyFromRequest(req);
      const expectedRowVersion = courseV2.rowVersionFromRequest(req);
      if (!idempotencyKey) {
        return fail(res, 'IDEMPOTENCY_KEY_REQUIRED', '取消場次需要 Idempotency-Key', 400);
      }
      if (!expectedRowVersion) {
        return fail(res, 'COURSE_ROW_VERSION_REQUIRED', '取消場次需要 If-Match', 428);
      }
      const v2Conn = await pool.getConnection();
      try {
        await ensureSchema();
        await courseV2.assertSchema();
        await v2Conn.beginTransaction();
        await courseV2.assertMutationAllowed(v2Conn);
        const sessionId = positiveInt(req.params.id);
        const [rows] = await v2Conn.query(
          `SELECT id, owner_user_id, status, row_version FROM course_sessions
            WHERE id = ?${isGlobalCourseManager(req.user) ? '' : ' AND owner_user_id = ?'}
            LIMIT 1 FOR UPDATE`,
          [
            sessionId,
            ...(!isGlobalCourseManager(req.user)
              ? [req.courseV2OwnerUserId || req.user.id]
              : []),
          ]
        );
        const session = rows[0];
        if (!session) return rollbackFail(v2Conn, res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
        const operation = 'session.cancel';
        const mutation = await courseV2.claimMutation(v2Conn, {
          actorUserId: req.user.id,
          operation,
          idempotencyKey,
          payload: { sessionId, expectedRowVersion },
          resourceType: 'session',
          resourceId: sessionId,
        });
        if (mutation.replay) {
          await v2Conn.commit();
          return ok(res, mutation.replay, '場次已取消');
        }
        if (Number(session.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        }
        const [updated] = await v2Conn.query(
          `UPDATE course_sessions
              SET status = 'cancelled', row_version = row_version + 1
            WHERE id = ? AND row_version = ?`,
          [sessionId, expectedRowVersion]
        );
        if (!updated.affectedRows) {
          return rollbackFail(v2Conn, res, 'COURSE_ROW_VERSION_CONFLICT', '場次已變更，請重新載入', 409);
        }
        const released = await cancelCourseSessionReservations(v2Conn, {
          sessionId,
          actorUserId: req.user.id,
        });
        const response = {
          id: sessionId,
          status: 'cancelled',
          rowVersion: Number(expectedRowVersion) + 1,
          ...released,
        };
        await courseV2.completeMutation(v2Conn, req.user.id, operation, mutation, response, {
          type: 'session',
          id: sessionId,
        });
        await v2Conn.commit();
        return ok(res, response, '場次已取消');
      } catch (error) {
        try { await v2Conn.rollback(); } catch (_) {}
        return handleError(res, 'ADMIN_COURSE_SESSION_CANCEL_FAIL', error);
      } finally {
        v2Conn.release();
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const id = positiveInt(req.params.id);
      const globalAccess = isGlobalCourseManager(req.user);
      const [rows] = await conn.query(
        `SELECT id, status FROM course_sessions
          WHERE id = ?${globalAccess ? '' : ' AND owner_user_id = ?'} LIMIT 1 FOR UPDATE`,
        globalAccess ? [id] : [id, req.user.id]
      );
      if (!rows.length) return rollbackFail(conn, res, 'COURSE_SESSION_NOT_FOUND', '找不到課程場次', 404);
      const [result] = await conn.query(
        `UPDATE course_sessions SET status = 'cancelled'
          WHERE id = ?${globalAccess ? '' : ' AND owner_user_id = ?'}`,
        globalAccess ? [id] : [id, req.user.id]
      );
      if (!result.affectedRows && rows[0].status !== 'cancelled') {
        return rollbackFail(conn, res, 'COURSE_SESSION_NOT_FOUND', '場次所有權已變更，請重新載入', 404);
      }
      await conn.commit();
      return ok(res, null, '場次已取消');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_SESSION_CANCEL_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/orders', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req);
      const where = [];
      const params = [];
      const orderProductNameExpression = courseV2.enabled
        ? "COALESCE(p.name, item_owner.item_name_snapshot, '')"
        : 'p.name';
      const orderUsernameExpression = courseV2.enabled
        ? "COALESCE(u.username, order_student.display_name, '')"
        : 'u.username';
      if (courseV2.enabled) appendCourseOrderOwnerScope(req, where, params);
      else appendManagerOwnerScope(req, 'p', where, params);
      if (paging.q) {
        where.push(`(o.code LIKE ? OR o.buyer_name LIKE ? OR o.buyer_email LIKE ?
          OR o.remittance_last5 LIKE ? OR ${orderProductNameExpression} LIKE ?
          OR ${orderUsernameExpression} LIKE ? OR provider.username LIKE ?)`);
        params.push(...Array(7).fill(`%${paging.q}%`));
      }
      const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]'], COURSE_ORDER_STATUSES);
      if (statuses.length) { where.push(`o.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
      const productId = positiveInt(req.query?.productId ?? req.query?.product_id);
      if (productId) { where.push('o.product_id = ?'); params.push(productId); }
      const orderUser = queryText(req.query?.user, 255);
      const orderProduct = queryText(req.query?.product, 255);
      if (orderUser) {
        where.push(`(o.buyer_name LIKE ? OR o.buyer_email LIKE ? OR ${orderUsernameExpression} LIKE ?)`);
        params.push(...Array(3).fill(`%${orderUser}%`));
      }
      if (orderProduct) {
        where.push(`${orderProductNameExpression} LIKE ?`);
        params.push(`%${orderProduct}%`);
      }
      const remittanceLast5 = queryText(req.query?.remittanceLast5 ?? req.query?.remittance_last5, 5);
      if (remittanceLast5) { where.push('o.remittance_last5 = ?'); params.push(remittanceLast5); }
      const amountMin = Number(firstValue(req.query?.amountMin ?? req.query?.amount_min));
      const amountMax = Number(firstValue(req.query?.amountMax ?? req.query?.amount_max));
      if (Number.isFinite(amountMin) && amountMin >= 0) { where.push('o.total_amount >= ?'); params.push(amountMin); }
      if (Number.isFinite(amountMax) && amountMax >= 0) { where.push('o.total_amount <= ?'); params.push(amountMax); }
      const createdFrom = queryDate(req.query?.createdFrom ?? req.query?.created_from);
      const createdTo = queryDate(req.query?.createdTo ?? req.query?.created_to);
      if (createdFrom) { where.push('o.created_at >= ?'); params.push(`${createdFrom} 00:00:00`); }
      if (createdTo) { where.push('o.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(createdTo); }
      const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const fromSql = courseV2.enabled
        ? `FROM course_orders o
           LEFT JOIN course_products p ON p.id = o.product_id
           LEFT JOIN course_students order_student ON order_student.id = o.student_id
           LEFT JOIN (
             SELECT oi.order_id, MIN(tp.owner_user_id) AS owner_user_id,
                    MIN(oi.item_name_snapshot) AS item_name_snapshot
               FROM course_order_items oi
               LEFT JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
              GROUP BY oi.order_id
           ) item_owner ON item_owner.order_id = o.id
           LEFT JOIN users u ON u.id = COALESCE(o.user_id, order_student.user_id)
           LEFT JOIN users provider
             ON provider.id = COALESCE(p.owner_user_id, item_owner.owner_user_id, order_student.owner_user_id)`
        : `FROM course_orders o
           JOIN course_products p ON p.id = o.product_id
           JOIN users u ON u.id = o.user_id
           LEFT JOIN users provider ON provider.id = p.owner_user_id`;
      const [rows] = await pool.query(
        `SELECT o.*, ${orderProductNameExpression} AS product_name,
                ${courseV2.enabled
    ? 'COALESCE(p.owner_user_id, item_owner.owner_user_id, order_student.owner_user_id)'
    : 'p.owner_user_id'} AS owner_user_id,
                ${orderUsernameExpression} AS username, provider.username AS provider_name,
                (SELECT COUNT(*) FROM course_tickets issued WHERE issued.order_id = o.id) AS issued_ticket_count,
                (SELECT GROUP_CONCAT(issued.code ORDER BY issued.id SEPARATOR ',') FROM course_tickets issued WHERE issued.order_id = o.id) AS ticket_codes
           ${fromSql}
          ${filterSql} ORDER BY o.created_at DESC, o.id DESC LIMIT ?${paging.paged ? ' OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : [...params, 500]
      );
      const rowsWithItems = courseV2.enabled
        ? await attachCourseOrderItems(pool, rows)
        : rows;
      const items = rowsWithItems.map(toCourseOrder);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total ${fromSql} ${filterSql}`,
        params
      );
      const summaryWhere = [];
      const summaryParams = [];
      if (courseV2.enabled) {
        appendCourseOrderOwnerScope(req, summaryWhere, summaryParams, { allowAdminFilters: false });
      } else {
        appendManagerOwnerScope(req, 'p', summaryWhere, summaryParams, { allowAdminFilters: false });
      }
      const [summaryRows] = await pool.query(
        `SELECT o.status, COUNT(*) AS total ${fromSql}
          ${summaryWhere.length ? `WHERE ${summaryWhere.join(' AND ')}` : ''} GROUP BY o.status`,
        summaryParams
      );
      const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
      const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_ORDERS_LIST_FAIL', error);
    }
  });

  router.patch('/admin/courses/orders/bulk', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      return fail(
        res,
        'COURSE_V2_BULK_UNSUPPORTED',
        '新版課程訂單需逐筆以版本號更新，暫不支援批次變更',
        409
      );
    }
    const ids = Array.from(new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
      .map((value) => positiveInt(value)).filter(Boolean)));
    const status = normalizeStatus(req.body?.status, COURSE_ORDER_STATUSES, '');
    if (!ids.length || ids.length > 100) return fail(res, 'VALIDATION_ERROR', '請選擇 1 至 100 筆訂單', 400);
    if (!status) return fail(res, 'VALIDATION_ERROR', '訂單狀態不正確', 400);
    if (status === 'issued') return fail(res, 'COURSE_ORDER_ISSUE_REQUIRED', '發券必須逐筆確認', 409);
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const params = [...ids];
      const ownerSql = isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?';
      if (!isGlobalCourseManager(req.user)) params.push(req.user.id);
      const [rows] = await conn.query(
        `SELECT o.id, o.status FROM course_orders o JOIN course_products p ON p.id = o.product_id
          WHERE o.id IN (${ids.map(() => '?').join(',')})${ownerSql} ORDER BY o.id FOR UPDATE`,
        params
      );
      if (rows.length !== ids.length) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '部分訂單不存在或不屬於目前服務商', 404);
      if (rows.some((row) => String(row.status) === 'issued')) {
        return rollbackFail(conn, res, 'COURSE_ORDER_STATUS_LOCKED', '已發券訂單不可批量變更狀態', 409);
      }
      const [updateResult] = await conn.query(
        `UPDATE course_orders o JOIN course_products p ON p.id = o.product_id
            SET o.status = ?, o.note = ?
          WHERE o.id IN (${ids.map(() => '?').join(',')})${ownerSql}`,
        [status, text(req.body?.note, 1000) || null, ...ids,
          ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      if (!updateResult.affectedRows && rows.some((row) => String(row.status || '') !== status)) {
        return rollbackFail(conn, res, 'COURSE_ORDER_UPDATE_CONFLICT', '訂單租戶或狀態已變更，請重新載入', 409);
      }
      await conn.commit();
      return ok(res, { updated: ids.length, ids, status }, '課程訂單已批量更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ORDERS_BULK_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/orders/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const params = [positiveInt(req.params.id)];
      const where = ['o.id = ?'];
      if (courseV2.enabled) {
        appendCourseOrderOwnerScope(req, where, params, { allowAdminFilters: false });
      } else {
        appendManagerOwnerScope(req, 'p', where, params, { allowAdminFilters: false });
      }
      const [rows] = await pool.query(
        `SELECT o.*, ${courseV2.enabled
    ? "COALESCE(p.name, item_owner.item_name_snapshot, '')"
    : 'p.name'} AS product_name,
                ${courseV2.enabled
    ? 'COALESCE(p.owner_user_id, item_owner.owner_user_id, order_student.owner_user_id)'
    : 'p.owner_user_id'} AS owner_user_id,
                ${courseV2.enabled
    ? "COALESCE(u.username, order_student.display_name, '')"
    : 'u.username'} AS username,
                provider.username AS provider_name,
                (SELECT COUNT(*) FROM course_tickets issued WHERE issued.order_id = o.id) AS issued_ticket_count,
                (SELECT GROUP_CONCAT(issued.code ORDER BY issued.id SEPARATOR ',') FROM course_tickets issued WHERE issued.order_id = o.id) AS ticket_codes
           FROM course_orders o
           ${courseV2.enabled ? 'LEFT JOIN' : 'JOIN'} course_products p ON p.id = o.product_id
           ${courseV2.enabled ? `
           LEFT JOIN course_students order_student ON order_student.id = o.student_id
           LEFT JOIN (
             SELECT oi.order_id, MIN(tp.owner_user_id) AS owner_user_id,
                    MIN(oi.item_name_snapshot) AS item_name_snapshot
               FROM course_order_items oi
               LEFT JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
              GROUP BY oi.order_id
           ) item_owner ON item_owner.order_id = o.id
           LEFT JOIN users u ON u.id = COALESCE(o.user_id, order_student.user_id)
           LEFT JOIN users provider
             ON provider.id = COALESCE(p.owner_user_id, item_owner.owner_user_id, order_student.owner_user_id)`
    : `JOIN users u ON u.id = o.user_id
       LEFT JOIN users provider ON provider.id = p.owner_user_id`}
          WHERE ${where.join(' AND ')} LIMIT 1`,
        params
      );
      if (!rows.length) return fail(res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      const [order] = courseV2.enabled
        ? await attachCourseOrderItems(pool, rows)
        : rows;
      return ok(res, toCourseOrder(order));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_ORDER_READ_FAIL', error);
    }
  });

  router.patch('/admin/courses/orders/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      const status = normalizeStatus(req.body?.status, COURSE_ORDER_STATUSES, '');
      if (!status) return fail(res, 'VALIDATION_ERROR', '訂單狀態不正確', 400);
      if (status === 'issued') {
        return fail(res, 'COURSE_ORDER_ISSUE_REQUIRED', '請使用發券按鈕完成訂單發券', 409);
      }
      try {
        await courseV2.assertSchema();
        const [scopeRows] = await pool.query(
          `SELECT o.id,
                  COALESCE(p.owner_user_id, item_owner.owner_user_id, student.owner_user_id)
                    AS owner_user_id
             FROM course_orders o
             LEFT JOIN course_products p ON p.id = o.product_id
             LEFT JOIN course_students student ON student.id = o.student_id
             LEFT JOIN (
               SELECT oi.order_id, MIN(tp.owner_user_id) AS owner_user_id
                 FROM course_order_items oi
                 JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
                GROUP BY oi.order_id
             ) item_owner ON item_owner.order_id = o.id
            WHERE o.id = ? LIMIT 1`,
          [positiveInt(req.params.id)]
        );
        const scope = scopeRows[0];
        if (!scope) return fail(res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
        await assertCourseV2TenantOpsScope(req, scope.owner_user_id);
        const result = await courseV2.withMutationTransaction(async (conn) => {
          const expectedRowVersion = courseV2.rowVersionFromRequest(req);
          if (!expectedRowVersion) {
            throw Object.assign(new Error('更新訂單需要 If-Match'), {
              code: 'COURSE_ROW_VERSION_REQUIRED',
              statusCode: 428,
            });
          }
          const mutation = await courseV2.claimMutation(conn, {
            actorUserId: req.user.id,
            operation: 'order.update-status',
            idempotencyKey: courseV2.mutationKeyFromRequest(req),
            payload: {
              orderId: Number(scope.id),
              expectedRowVersion,
              status,
              note: text(req.body?.note, 1000),
            },
            resourceType: 'order',
            resourceId: scope.id,
          });
          if (mutation.replay) return mutation.replay;
          const [orderRows] = await conn.query(
            'SELECT id, status, row_version FROM course_orders WHERE id = ? LIMIT 1 FOR UPDATE',
            [scope.id]
          );
          const order = orderRows[0];
          if (!order) throw Object.assign(new Error('找不到課程訂單'), { code: 'COURSE_ORDER_NOT_FOUND', statusCode: 404 });
          if (Number(order.row_version || 1) !== expectedRowVersion) {
            throw Object.assign(new Error('訂單已變更，請重新載入'), { code: 'COURSE_ROW_VERSION_CONFLICT', statusCode: 409 });
          }
          if (order.status === 'issued') {
            throw Object.assign(new Error('已發券訂單不可變更狀態'), { code: 'COURSE_ORDER_STATUS_LOCKED', statusCode: 409 });
          }
          const [updated] = await conn.query(
            `UPDATE course_orders
                SET status = ?, note = ?, row_version = row_version + 1
              WHERE id = ? AND row_version = ? AND status <> 'issued'`,
            [status, text(req.body?.note, 1000) || null, scope.id, expectedRowVersion]
          );
          if (!updated.affectedRows) {
            throw Object.assign(new Error('訂單已變更，請重新載入'), { code: 'COURSE_ROW_VERSION_CONFLICT', statusCode: 409 });
          }
          const response = { id: Number(scope.id), status, rowVersion: expectedRowVersion + 1 };
          await courseV2.completeMutation(
            conn,
            req.user.id,
            'order.update-status',
            mutation,
            response,
            { type: 'order', id: scope.id }
          );
          return response;
        });
        return ok(res, result, '課程訂單已更新');
      } catch (error) {
        return handleError(res, 'ADMIN_COURSE_ORDER_UPDATE_FAIL', error);
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const status = normalizeStatus(req.body?.status, COURSE_ORDER_STATUSES, '');
      if (!status) return rollbackFail(conn, res, 'VALIDATION_ERROR', '訂單狀態不正確', 400);
      const ownerWhere = isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?';
      const ownerParams = isGlobalCourseManager(req.user) ? [] : [req.user.id];
      const [orderRows] = await conn.query(
        `SELECT o.id, o.status FROM course_orders o JOIN course_products p ON p.id = o.product_id
          WHERE o.id = ?${ownerWhere} LIMIT 1 FOR UPDATE`,
        [positiveInt(req.params.id), ...ownerParams]
      );
      if (!orderRows.length) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      if (orderRows[0].status === 'issued' && status !== 'issued') {
        return rollbackFail(conn, res, 'COURSE_ORDER_STATUS_LOCKED', '已發券訂單不可變更狀態', 409);
      }
      if (status === 'issued') {
        if (orderRows[0].status !== 'issued') {
          return rollbackFail(conn, res, 'COURSE_ORDER_ISSUE_REQUIRED', '請使用發券按鈕完成訂單發券', 409);
        }
      }
      const [result] = await conn.query(
        `UPDATE course_orders o JOIN course_products p ON p.id = o.product_id
            SET o.status = ?, o.note = ? WHERE o.id = ?${ownerWhere}`,
        [status, text(req.body?.note, 1000) || null, positiveInt(req.params.id), ...ownerParams]
      );
      if (!result.affectedRows && orderRows[0].status !== status) {
        return rollbackFail(conn, res, 'COURSE_ORDER_UPDATE_CONFLICT', '訂單租戶或狀態已變更，請重新載入', 409);
      }
      await conn.commit();
      return ok(res, null, '課程訂單已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ORDER_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  async function ensureCourseStudent(conn, {
    ownerUserId = null,
    userId,
    email,
    displayName,
  }) {
    const emailNormalized = normalizeCourseTransferEmail(email);
    const tenantKey = ownerUserId || '00000000-0000-0000-0000-000000000000';
    if (!userId || !emailNormalized) {
      throw Object.assign(new Error('建立課程學員需要已驗證的平台帳號與 Email'), {
        code: 'COURSE_STUDENT_IDENTITY_REQUIRED',
        statusCode: 409,
      });
    }
    const [rows] = await conn.query(
      `SELECT *
         FROM course_students
        WHERE tenant_key = ? AND (user_id = ? OR email_normalized = ?)
        ORDER BY id
        FOR UPDATE`,
      [tenantKey, userId, emailNormalized]
    );
    if (rows.length > 1 || (rows[0]?.user_id && String(rows[0].user_id) !== String(userId))) {
      throw Object.assign(new Error('此 Email 的課程學員資料已連結至另一個平台帳號'), {
        code: 'COURSE_STUDENT_CLAIM_CONFLICT',
        statusCode: 409,
      });
    }
    if (rows[0]) {
      await conn.query(
        `UPDATE course_students
            SET user_id = ?, email = ?, email_normalized = ?, display_name = ?,
                status = 'claimed', claimed_at = COALESCE(claimed_at, NOW()),
                row_version = row_version + 1
          WHERE id = ?`,
        [userId, emailNormalized, emailNormalized, text(displayName, 255) || emailNormalized, rows[0].id]
      );
      return { ...rows[0], id: Number(rows[0].id), user_id: userId };
    }
    const [insert] = await conn.query(
      `INSERT INTO course_students
        (owner_user_id, tenant_key, user_id, email, email_normalized,
         display_name, status, source_system, claimed_at, row_version)
       VALUES (?, ?, ?, ?, ?, ?, 'claimed', 'leader', NOW(), 1)`,
      [
        ownerUserId,
        tenantKey,
        userId,
        emailNormalized,
        emailNormalized,
        text(displayName, 255) || emailNormalized,
      ]
    );
    return { id: Number(insert.insertId), user_id: userId };
  }

  async function issueTicket(conn, {
    userId,
    studentId = null,
    ownerName,
    ownerEmail,
    product,
    ticketProduct = null,
    orderId = null,
    orderItemId = null,
    actorUserId = null,
    commandId = null,
  }) {
    const code = await uniqueCode('course_tickets', 'TK', conn);
    const issuedAt = new Date();
    if (courseV2.enabled) {
      if (!ticketProduct) {
        const [ticketProductRows] = await conn.query(
          `SELECT tp.*, provider.username AS provider_name
             FROM course_ticket_products tp
             LEFT JOIN users provider ON provider.id = tp.owner_user_id
            WHERE tp.id = ? AND tp.owner_user_id <=> ?
            LIMIT 1 FOR UPDATE`,
          [positiveInt(product?.ticket_product_id), product?.owner_user_id || null]
        );
        [ticketProduct] = ticketProductRows;
      }
      if (!ticketProduct) {
        throw Object.assign(new Error('銷售方案尚未設定可發行的票券產品'), {
          code: 'COURSE_TICKET_PRODUCT_REQUIRED',
          statusCode: 409,
        });
      }
      const classCount = positiveInt(ticketProduct.class_count, 1, 9999);
      const activationDeadline = addCourseCalendarDays(
        issuedAt,
        positiveInt(ticketProduct.activation_days, 120, 3650)
      );
      const resolvedStudent = studentId
        ? { id: Number(studentId) }
        : await ensureCourseStudent(conn, {
          ownerUserId: ticketProduct.owner_user_id,
          userId,
          email: ownerEmail,
          displayName: ownerName,
        });
      const [result] = await conn.query(
        `INSERT INTO course_tickets
          (code, user_id, student_id, owner_name, owner_email, product_id,
           ticket_product_id, order_id, order_item_id, total_uses,
           remaining_uses, remaining_uses_cache, status, issued_at,
           activation_deadline, transferable, product_code_snapshot,
           product_name_snapshot, product_class_count_snapshot,
           product_valid_days_snapshot, product_activation_days_snapshot,
           product_transferable_snapshot, product_max_transfers_snapshot,
           product_terms_snapshot, product_redemption_policy_snapshot,
           provider_user_id_snapshot, provider_name_snapshot, row_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'pending', NOW(), ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          code,
          userId,
          resolvedStudent.id,
          ownerName || '',
          ownerEmail,
          product?.id || null,
          ticketProduct.id,
          orderId,
          orderItemId,
          classCount,
          activationDeadline,
          Number(ticketProduct.transferable || 0),
          ticketProduct.code,
          ticketProduct.name,
          classCount,
          positiveInt(ticketProduct.valid_days, 120, 3650),
          positiveInt(ticketProduct.activation_days, 120, 3650),
          Number(ticketProduct.transferable || 0),
          nonNegativeInt(ticketProduct.max_transfers, 1, 100),
          ticketProduct.terms_text || null,
          ticketProduct.redemption_policy_json || null,
          ticketProduct.owner_user_id || null,
          ticketProduct.provider_name || product?.provider_name || '',
        ]
      );
      const ticketId = Number(result.insertId);
      const issuance = await courseV2.recordIssuance(conn, {
        ticketId,
        studentId: resolvedStudent.id,
        userId,
        totalUses: classCount,
        actorUserId: actorUserId || userId,
        idempotencyKey: `issuance:${ticketId}`,
        sourceType: orderItemId ? 'order_item' : 'manual_issue',
        sourceId: orderItemId ? `${orderItemId}:${ticketId}` : ticketId,
        commandId,
      });
      return {
        id: ticketId,
        code,
        ticketProductId: Number(ticketProduct.id),
        rowVersion: 2,
        issuanceEventId: issuance.id,
        remainingUses: classCount,
      };
    }
    const activationDeadline = addCourseCalendarDays(
      issuedAt,
      Number(product.activation_days || 120)
    );
    const [result] = await conn.query(
      `INSERT INTO course_tickets
        (code, user_id, owner_name, owner_email, product_id, order_id, total_uses, remaining_uses, status, issued_at, activation_deadline, transferable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?, ?)`,
      [code, userId, ownerName || '', ownerEmail, product.id, orderId, Number(product.class_count || 1), Number(product.class_count || 1), activationDeadline, Number(product.transferable || 0)]
    );
    return { id: Number(result.insertId), code };
  }

  router.post('/admin/courses/orders/:id/issue', courseManagerRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const [orderRows] = await conn.query(
        `SELECT o.*,
                COALESCE(p.owner_user_id, item_owner.owner_user_id, student.owner_user_id)
                  AS owner_user_id,
                provider.username AS provider_name
           FROM course_orders o
           LEFT JOIN course_products p ON p.id = o.product_id
           LEFT JOIN course_students student ON student.id = o.student_id
           LEFT JOIN (
             SELECT oi.order_id, MIN(tp.owner_user_id) AS owner_user_id
               FROM course_order_items oi
               JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
              GROUP BY oi.order_id
           ) item_owner ON item_owner.order_id = o.id
           LEFT JOIN users provider
             ON provider.id = COALESCE(p.owner_user_id, item_owner.owner_user_id, student.owner_user_id)
          WHERE o.id = ?${courseV2.enabled || isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'}
          LIMIT 1 FOR UPDATE`,
        [
          positiveInt(req.params.id),
          ...(!courseV2.enabled && !isGlobalCourseManager(req.user) ? [req.user.id] : []),
        ]
      );
      const order = orderRows[0];
      if (!order) return rollbackFail(conn, res, 'COURSE_ORDER_NOT_FOUND', '找不到課程訂單', 404);
      let mutation = null;
      let expectedRowVersion = null;
      if (courseV2.enabled) {
        await assertCourseV2TenantOpsScope(req, order.owner_user_id);
        const idempotencyKey = courseV2.mutationKeyFromRequest(req);
        expectedRowVersion = courseV2.rowVersionFromRequest(req);
        if (!idempotencyKey) {
          return rollbackFail(conn, res, 'IDEMPOTENCY_KEY_REQUIRED', '發券需要 Idempotency-Key', 400);
        }
        if (!expectedRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '發券需要訂單 If-Match', 428);
        }
        if (Number(order.row_version || 1) !== Number(expectedRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '訂單已變更，請重新載入', 409);
        }
        mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'order.issue',
          idempotencyKey,
          payload: { orderId: Number(order.id), expectedRowVersion },
          resourceType: 'order',
          resourceId: order.id,
        });
        if (mutation.replay) {
          await conn.commit();
          return ok(res, mutation.replay, '發券完成');
        }
        if (String(order.status) !== 'paid') {
          return rollbackFail(conn, res, 'COURSE_ORDER_NOT_PAID', '訂單付款確認後才能發券', 409);
        }
      }
      const [existingRows] = await conn.query('SELECT id, code FROM course_tickets WHERE order_id = ? ORDER BY id', [order.id]);
      if (existingRows.length) return rollbackFail(conn, res, 'COURSE_ORDER_ALREADY_ISSUED', '此訂單已完成發券', 409);
      const product = order.product_id
        ? await findProduct(order.product_id, {
          conn,
          manager: courseV2.enabled ? null : req,
          forUpdate: true,
        })
        : (courseV2.enabled ? {
          id: null,
          owner_user_id: order.owner_user_id || null,
          provider_name: order.provider_name || '',
        } : null);
      if (!product) return rollbackFail(conn, res, 'COURSE_PRODUCT_NOT_FOUND', '課程所有權已變更，請重新載入', 404);
      const tickets = [];
      if (courseV2.enabled) {
        const [itemRows] = await conn.query(
          `SELECT oi.id AS order_item_id, oi.shop_product_id, oi.ticket_product_id,
                  oi.quantity, oi.issuance_status,
                  tp.code, tp.name, tp.class_count, tp.valid_days,
                  tp.activation_days, tp.transferable, tp.max_transfers,
                  tp.terms_text, tp.redemption_policy_json, tp.owner_user_id,
                  provider.username AS provider_name
             FROM course_order_items oi
             JOIN course_ticket_products tp ON tp.id = oi.ticket_product_id
             LEFT JOIN users provider ON provider.id = tp.owner_user_id
            WHERE oi.order_id = ?
            ORDER BY oi.id
            FOR UPDATE`,
          [order.id]
        );
        if (!itemRows.length || itemRows.some((item) => (
          item.issuance_status !== 'pending'
          || String(item.owner_user_id || '') !== String(order.owner_user_id || '')
        ))) {
          return rollbackFail(conn, res, 'COURSE_ORDER_ITEMS_INVALID', '訂單票券明細缺失、已發行或租戶已變更', 409);
        }
        const student = order.student_id
          ? { id: Number(order.student_id) }
          : await ensureCourseStudent(conn, {
            ownerUserId: order.owner_user_id,
            userId: order.user_id,
            email: order.buyer_email,
            displayName: order.buyer_name,
          });
        for (const item of itemRows) {
          for (let index = 0; index < Number(item.quantity || 0); index += 1) {
            tickets.push(await issueTicket(conn, {
              userId: order.user_id,
              studentId: student.id,
              ownerName: order.buyer_name,
              ownerEmail: order.buyer_email,
              product: {
                ...product,
                id: item.shop_product_id || product.id || null,
                owner_user_id: item.owner_user_id,
                provider_name: item.provider_name || order.provider_name,
              },
              ticketProduct: {
                id: item.ticket_product_id,
                code: item.code,
                name: item.name,
                class_count: item.class_count,
                valid_days: item.valid_days,
                activation_days: item.activation_days,
                transferable: item.transferable,
                max_transfers: item.max_transfers,
                terms_text: item.terms_text,
                redemption_policy_json: item.redemption_policy_json,
                owner_user_id: item.owner_user_id,
                provider_name: item.provider_name || order.provider_name,
              },
              orderId: order.id,
              orderItemId: item.order_item_id,
              actorUserId: req.user.id,
              commandId: mutation.commandId,
            }));
          }
          await conn.query(
            `UPDATE course_order_items
                SET issuance_status = 'issued', row_version = row_version + 1
              WHERE id = ? AND issuance_status = 'pending'`,
            [item.order_item_id]
          );
        }
      } else {
        for (let i = 0; i < Number(order.quantity); i += 1) {
          tickets.push(await issueTicket(conn, {
            userId: order.user_id,
            ownerName: order.buyer_name,
            ownerEmail: order.buyer_email,
            product,
            orderId: order.id,
          }));
        }
      }
      const [orderResult] = courseV2.enabled
        ? await conn.query(
          `UPDATE course_orders
              SET status = 'issued', row_version = row_version + 1
            WHERE id = ? AND row_version = ? AND status = 'paid'`,
          [order.id, expectedRowVersion]
        )
        : await conn.query(
          `UPDATE course_orders o JOIN course_products p ON p.id = o.product_id
              SET o.status = 'issued'
            WHERE o.id = ?${isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'}`,
          [order.id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
        );
      if (!orderResult.affectedRows && order.status !== 'issued') {
        return rollbackFail(conn, res, 'COURSE_ORDER_UPDATE_CONFLICT', '訂單租戶或狀態已變更，請重新載入', 409);
      }
      const response = {
        tickets,
        ...(courseV2.enabled ? { orderId: Number(order.id), rowVersion: expectedRowVersion + 1 } : {}),
      };
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'order.issue',
          mutation,
          response,
          { type: 'order', id: order.id }
        );
      }
      await conn.commit();
      return ok(res, response, '發券完成');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ORDER_ISSUE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/tickets', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req);
      const where = [];
      const params = [];
      const productNameExpression = courseV2.enabled
        ? "COALESCE(t.product_name_snapshot, tp.name, p.name, '')"
        : 'p.name';
      const holderNameExpression = courseV2.enabled
        ? "COALESCE(u.username, student.display_name, '')"
        : 'u.username';
      if (courseV2.enabled) appendCourseTicketOwnerScope(req, where, params);
      else appendManagerOwnerScope(req, 'p', where, params);
      if (paging.q) {
        where.push(`(t.code LIKE ? OR t.owner_name LIKE ? OR t.owner_email LIKE ?
          OR ${productNameExpression} LIKE ?
          OR ${holderNameExpression} LIKE ?
          OR provider.username LIKE ?)`);
        params.push(...Array(6).fill(`%${paging.q}%`));
      }
      const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]'], COURSE_TICKET_STATUSES);
      if (statuses.length) { where.push(`t.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
      const productId = positiveInt(req.query?.productId ?? req.query?.product_id);
      if (productId) { where.push('t.product_id = ?'); params.push(productId); }
      const holder = queryText(req.query?.holder, 255);
      const ticketProduct = queryText(req.query?.product, 255);
      if (holder) {
        where.push(`(t.owner_name LIKE ? OR t.owner_email LIKE ? OR ${holderNameExpression} LIKE ?)`);
        params.push(...Array(3).fill(`%${holder}%`));
      }
      if (ticketProduct) {
        where.push(`${productNameExpression} LIKE ?`);
        params.push(`%${ticketProduct}%`);
      }
      const remainingMinRaw = req.query?.remainingMin ?? req.query?.remaining_min;
      const remainingMaxRaw = req.query?.remainingMax ?? req.query?.remaining_max;
      const remainingMin = remainingMinRaw === undefined ? null : nonNegativeInt(remainingMinRaw, null);
      const remainingMax = remainingMaxRaw === undefined ? null : nonNegativeInt(remainingMaxRaw, null);
      if (remainingMin !== null) {
        where.push('COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) >= ?');
        params.push(remainingMin);
      }
      if (remainingMax !== null) {
        where.push('COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) <= ?');
        params.push(remainingMax);
      }
      const createdFrom = queryDate(req.query?.createdFrom ?? req.query?.created_from);
      const createdTo = queryDate(req.query?.createdTo ?? req.query?.created_to);
      if (createdFrom) { where.push('t.created_at >= ?'); params.push(`${createdFrom} 00:00:00`); }
      if (createdTo) { where.push('t.created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(createdTo); }
      const expiryFrom = queryDate(req.query?.expiryFrom ?? req.query?.expiry_from);
      const expiryTo = queryDate(req.query?.expiryTo ?? req.query?.expiry_to);
      if (expiryFrom) { where.push('t.expires_at >= ?'); params.push(expiryFrom); }
      if (expiryTo) { where.push('t.expires_at <= ?'); params.push(expiryTo); }
      const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const fromSql = courseV2.enabled
        ? `FROM course_tickets t
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = t.product_id
           LEFT JOIN course_students student ON student.id = t.student_id
           LEFT JOIN users u ON u.id = COALESCE(t.user_id, student.user_id)
           LEFT JOIN users provider
             ON provider.id = COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)`
        : `FROM course_tickets t
           JOIN course_products p ON p.id = t.product_id
           JOIN users u ON u.id = t.user_id
           LEFT JOIN users provider ON provider.id = p.owner_user_id`;
      const [rows] = await pool.query(
        `SELECT t.*, ${productNameExpression} AS product_name,
                ${courseV2.enabled
    ? 'COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id)'
    : 'p.owner_user_id'} AS owner_user_id,
                ${courseV2.enabled
    ? "COALESCE(u.username, student.display_name, t.owner_name, '')"
    : 'u.username'} AS username,
                ${courseV2.enabled
    ? "COALESCE(u.email, student.email, t.owner_email, '')"
    : 'u.email'} AS email,
                provider.username AS provider_name
           ${fromSql}
          ${filterSql} ORDER BY t.created_at DESC, t.id DESC LIMIT ?${paging.paged ? ' OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : [...params, 500]
      );
      const balancedRows = courseV2.enabled
        ? await courseV2.enrichTicketBalances(rows, null)
        : rows;
      const items = balancedRows.map(toTicket);
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total ${fromSql} ${filterSql}`,
        params
      );
      const summaryWhere = [];
      const summaryParams = [];
      if (courseV2.enabled) {
        appendCourseTicketOwnerScope(req, summaryWhere, summaryParams, { allowAdminFilters: false });
      } else {
        appendManagerOwnerScope(req, 'p', summaryWhere, summaryParams, { allowAdminFilters: false });
      }
      const [summaryRows] = await pool.query(
        `SELECT t.status, COUNT(*) AS total ${fromSql}
          ${summaryWhere.length ? `WHERE ${summaryWhere.join(' AND ')}` : ''} GROUP BY t.status`,
        summaryParams
      );
      const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
      const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_TICKETS_LIST_FAIL', error);
    }
  });

  router.get('/admin/courses/tickets/:id/activity', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const ticketId = positiveInt(req.params.id);
      const scopedOwnerUserId = req.courseV2OwnerUserId || req.user.id;
      const [ticketRows] = await pool.query(
        courseV2.enabled
          ? `SELECT t.id
               FROM course_tickets t
               LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
               LEFT JOIN course_products p ON p.id = t.product_id
              WHERE t.id = ?${isGlobalCourseManager(req.user)
    ? ''
    : ' AND COALESCE(t.provider_user_id_snapshot, tp.owner_user_id, p.owner_user_id) = ?'}
              LIMIT 1`
          : `SELECT t.id FROM course_tickets t JOIN course_products p ON p.id = t.product_id
              WHERE t.id = ?${isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'} LIMIT 1`,
        [ticketId, ...(!isGlobalCourseManager(req.user) ? [scopedOwnerUserId] : [])]
      );
      if (!ticketRows.length) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      const limit = Math.min(positiveInt(req.query?.limit, 50), 100);
      const cursorRaw = queryText(req.query?.cursor, 500);
      const cursor = decodeCourseActivityCursor(cursorRaw);
      if (cursorRaw && !cursor) return fail(res, 'COURSE_ACTIVITY_CURSOR_INVALID', '活動紀錄游標無效', 400);
      const cursorWhere = cursor?.createdAt
        ? 'WHERE (activity.created_at < ? OR (activity.created_at = ? AND activity.id < ?))'
        : '';
      const activityParams = [ticketId, ticketId, ticketId, ticketId];
      if (cursor?.createdAt) activityParams.push(cursor.createdAt, cursor.createdAt, cursor.id);
      activityParams.push(limit + 1);
      if (cursor && Object.prototype.hasOwnProperty.call(cursor, 'legacyOffset')) {
        activityParams.push(cursor.legacyOffset);
      }
      const [rows] = await pool.query(
        `SELECT activity.* FROM (
           SELECT CONCAT('attendance:', l.id) AS id, 'attendance' AS type, l.action,
                  l.quantity, l.note, l.created_at, l.booking_id, l.session_id
             FROM course_attendance_logs l WHERE l.ticket_id = ?
           UNION ALL
           SELECT CONCAT('booking:', b.id) AS id, 'booking' AS type, b.status AS action,
                  0 AS quantity, NULL AS note, COALESCE(b.attended_at, b.cancelled_at, b.booked_at) AS created_at,
                  b.id AS booking_id, b.session_id
             FROM course_bookings b WHERE b.ticket_id = ?
           UNION ALL
           SELECT CONCAT('transfer:', l.id) AS id, 'transfer' AS type, l.action,
                  0 AS quantity, l.method AS note, l.created_at, NULL AS booking_id, NULL AS session_id
             FROM course_ticket_transfer_logs l WHERE l.ticket_id = ?
           UNION ALL
           SELECT CONCAT('issuance:', t.id) AS id, 'issuance' AS type, 'issued' AS action,
                  t.total_uses AS quantity, NULL AS note, t.created_at, NULL AS booking_id, NULL AS session_id
             FROM course_tickets t WHERE t.id = ?
           ${courseV2.enabled ? `
           UNION ALL
           SELECT CONCAT('usage:', e.id) AS id, 'usage' AS type, e.event_type AS action,
                  e.delta_uses AS quantity, e.note, e.created_at, e.booking_id, e.session_id
             FROM course_usage_events e WHERE e.ticket_id = ?` : ''}
         ) activity ${cursorWhere} ORDER BY activity.created_at DESC, activity.id DESC
         LIMIT ?${cursor && Object.prototype.hasOwnProperty.call(cursor, 'legacyOffset') ? ' OFFSET ?' : ''}`,
        courseV2.enabled
          ? [...activityParams.slice(0, 4), ticketId, ...activityParams.slice(4)]
          : activityParams
      );
      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      return ok(res, {
        items,
        nextCursor: hasMore ? encodeCourseActivityCursor(items[items.length - 1]) : null,
        hasMore,
      });
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_TICKET_ACTIVITY_FAIL', error);
    }
  });

  router.post('/admin/courses/tickets', courseManagerRequired, async (req, res) => {
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      if (courseV2.enabled) await courseV2.assertSchema();
      await conn.beginTransaction();
      await courseV2.assertMutationAllowed(conn);
      const ownerEmail = text(req.body?.ownerEmail ?? req.body?.owner_email, 255).toLowerCase();
      const requestedProductId = positiveInt(req.body?.productId ?? req.body?.product_id);
      const requestedTicketProductId = positiveInt(
        req.body?.ticketProductId ?? req.body?.ticket_product_id
      );
      let product = requestedProductId
        ? await findProduct(requestedProductId, { conn, manager: req, forUpdate: true })
        : null;
      let ticketProduct = null;
      if (courseV2.enabled && requestedTicketProductId) {
        const [ticketProductRows] = await conn.query(
          `SELECT tp.*, provider.username AS provider_name
             FROM course_ticket_products tp
             LEFT JOIN users provider ON provider.id = tp.owner_user_id
            WHERE tp.id = ? AND tp.status NOT IN ('archived', 'disabled')
            LIMIT 1 FOR UPDATE`,
          [requestedTicketProductId]
        );
        ticketProduct = ticketProductRows[0] || null;
        if (ticketProduct) {
          await assertCourseV2TenantOpsScope(req, ticketProduct.owner_user_id);
        }
      }
      if (!ownerEmail || (!product && !ticketProduct)) {
        return rollbackFail(
          conn,
          res,
          'VALIDATION_ERROR',
          courseV2.enabled
            ? '請選擇屬於目前租戶的票券產品並填寫持有人 Email'
            : '請選擇屬於目前租戶的商品並填寫持有人 Email',
          400
        );
      }
      if (
        courseV2.enabled
        && product
        && ticketProduct
        && String(product.owner_user_id || '') !== String(ticketProduct.owner_user_id || '')
      ) {
        return rollbackFail(conn, res, 'COURSE_OWNER_MISMATCH', '銷售方案與票券產品必須屬於同一租戶', 409);
      }
      if (courseV2.enabled && !product) {
        product = {
          id: null,
          ticket_product_id: ticketProduct.id,
          code: ticketProduct.code,
          name: ticketProduct.name,
          owner_user_id: ticketProduct.owner_user_id,
          provider_name: ticketProduct.provider_name || '',
        };
      }
      let mutation = null;
      if (courseV2.enabled) {
        const idempotencyKey = courseV2.mutationKeyFromRequest(req);
        const expectedSourceRowVersion = courseV2.rowVersionFromRequest(req);
        if (!idempotencyKey) {
          return rollbackFail(conn, res, 'IDEMPOTENCY_KEY_REQUIRED', '手動發券需要 Idempotency-Key', 400);
        }
        if (!expectedSourceRowVersion) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_REQUIRED', '手動發券需要票券產品 If-Match', 428);
        }
        const sourceRow = ticketProduct || product;
        if (Number(sourceRow.row_version || 1) !== Number(expectedSourceRowVersion)) {
          return rollbackFail(conn, res, 'COURSE_ROW_VERSION_CONFLICT', '票券產品已變更，請重新載入', 409);
        }
        mutation = await courseV2.claimMutation(conn, {
          actorUserId: req.user.id,
          operation: 'ticket.manual-issue',
          idempotencyKey,
          payload: {
            productId: product.id == null ? null : Number(product.id),
            ticketProductId: Number(ticketProduct?.id || product.ticket_product_id),
            ownerEmail,
            expectedSourceRowVersion,
          },
          resourceType: ticketProduct ? 'ticket_product' : 'shop_product',
          resourceId: ticketProduct?.id || product.id,
        });
        if (mutation.replay) {
          await conn.commit();
          return ok(res, mutation.replay, '票券已發行');
        }
      }
      const [userRows] = await conn.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [ownerEmail]);
      const user = userRows[0];
      if (!user) return rollbackFail(conn, res, 'COURSE_TICKET_USER_NOT_FOUND', '持有人需先註冊平台帳號', 404);
      const ticket = await issueTicket(conn, {
        userId: user.id,
        ownerName: user.username,
        ownerEmail: user.email,
        product,
        ticketProduct,
        actorUserId: req.user.id,
        commandId: mutation?.commandId || null,
      });
      if (courseV2.enabled) {
        await courseV2.completeMutation(
          conn,
          req.user.id,
          'ticket.manual-issue',
          mutation,
          ticket,
          { type: 'ticket', id: ticket.id }
        );
      }
      await conn.commit();
      return ok(res, ticket, '票券已發行');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_TICKET_ISSUE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.patch('/admin/courses/tickets/:id', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      try {
        await courseV2.assertSchema();
        const [ticketRows] = await pool.query(
          `SELECT t.id, t.status, t.expires_at, t.pause_reason, t.row_version,
                  CASE WHEN t.product_code_snapshot IS NOT NULL
                    THEN t.provider_user_id_snapshot
                    ELSE tp.owner_user_id
                  END AS owner_user_id
             FROM course_tickets t
             LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
            WHERE t.id = ? LIMIT 1`,
          [positiveInt(req.params.id)]
        );
        const ticket = ticketRows[0];
        if (!ticket) return fail(res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
        await assertCourseV2TenantOpsScope(req, ticket.owner_user_id);
        const requestedStatus = req.body?.status;
        const requestedExpiry = req.body?.expiresAt ?? req.body?.expires_at;
        if ((requestedStatus && requestedStatus !== ticket.status)
          || (requestedExpiry !== undefined && dateOnly(requestedExpiry) !== dateOnly(ticket.expires_at))) {
          return fail(
            res,
            'COURSE_COMPENSATING_EVENT_REQUIRED',
            '票券狀態與效期需使用 pause/resume/freeze 或補償事件，不能直接覆寫',
            409
          );
        }
        const balance = await courseV2.ledgerBalance(pool, ticket.id);
        const requestedRemaining = nonNegativeInt(
          req.body?.remainingUses ?? req.body?.remaining_uses,
          balance.remainingUses,
          9999
        );
        const deltaUses = requestedRemaining - balance.remainingUses;
        if (!deltaUses) {
          if (Number(ticket.row_version || 1) !== Number(courseV2.rowVersionFromRequest(req))) {
            return fail(res, 'COURSE_ROW_VERSION_CONFLICT', '票券已變更，請重新載入', 409);
          }
          return ok(res, {
            ticketId: Number(ticket.id),
            balance,
            rowVersion: Number(ticket.row_version || 1),
          }, '票券無需調整');
        }
        const result = await courseV2.adjustTicket({
          ticketId: ticket.id,
          deltaUses,
          actorUserId: req.user.id,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
          note: req.body?.note ?? req.body?.pauseReason ?? req.body?.pause_reason,
          reason: 'legacy_ticket_patch',
        });
        return ok(res, result, '票券堂數已以調整事件更新');
      } catch (error) {
        return handleError(res, 'ADMIN_COURSE_TICKET_UPDATE_FAIL', error);
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const id = positiveInt(req.params.id);
      const [rows] = await conn.query(
        `SELECT t.* FROM course_tickets t JOIN course_products p ON p.id = t.product_id
          WHERE t.id = ?${isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'} LIMIT 1 FOR UPDATE`,
        [id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      const current = rows[0];
      if (!current) return rollbackFail(conn, res, 'COURSE_TICKET_NOT_FOUND', '找不到課程票券', 404);
      const remainingUses = nonNegativeInt(req.body?.remainingUses ?? req.body?.remaining_uses, Number(current.remaining_uses), 9999);
      let status = normalizeStatus(req.body?.status ?? current.status, COURSE_TICKET_STATUSES, current.status);
      if (remainingUses === 0 && !['void', 'expired'].includes(status)) status = 'exhausted';
      const hasExpiresAt = Object.prototype.hasOwnProperty.call(req.body || {}, 'expiresAt')
        || Object.prototype.hasOwnProperty.call(req.body || {}, 'expires_at');
      const expiresAt = hasExpiresAt
        ? dateOnly(req.body?.expiresAt ?? req.body?.expires_at)
        : dateOnly(current.expires_at);
      const [result] = await conn.query(
        `UPDATE course_tickets t JOIN course_products p ON p.id = t.product_id
            SET t.remaining_uses = ?, t.status = ?, t.expires_at = ?, t.pause_reason = ?
          WHERE t.id = ?${isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'}`,
        [remainingUses, status, expiresAt, text(req.body?.pauseReason ?? req.body?.pause_reason ?? current.pause_reason, 500) || null,
          id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      if (!result.affectedRows
        && (Number(current.remaining_uses) !== remainingUses || String(current.status) !== status)) {
        return rollbackFail(conn, res, 'COURSE_TICKET_UPDATE_CONFLICT', '票券租戶或狀態已變更，請重新載入', 409);
      }
      await conn.commit();
      return ok(res, null, '課程票券已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_TICKET_UPDATE_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.get('/admin/courses/bookings', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const paging = pagingOptions(req);
      const where = [];
      const params = [];
      appendManagerOwnerScope(req, 's', where, params);
      if (paging.q) {
        where.push('(b.attendee_name LIKE ? OR b.attendee_email LIKE ? OR s.code LIKE ? OR s.title LIKE ? OR t.code LIKE ? OR p.name LIKE ? OR provider.username LIKE ?)');
        params.push(...Array(7).fill(`%${paging.q}%`));
      }
      const statuses = queryList(req.query?.statuses ?? req.query?.['statuses[]'], COURSE_BOOKING_STATUSES);
      if (statuses.length) { where.push(`b.status IN (${statuses.map(() => '?').join(',')})`); params.push(...statuses); }
      const sessionId = positiveInt(req.query?.sessionId ?? req.query?.session_id);
      if (sessionId) { where.push('b.session_id = ?'); params.push(sessionId); }
      for (const [raw, expression] of [
        [req.query?.session, 's.title'],
        [req.query?.product, 'p.name'],
        [req.query?.ticket, 't.code'],
        [req.query?.user, 'b.attendee_name'],
        [req.query?.location, 's.location'],
        [req.query?.coach, "COALESCE(s.coach_name, coach.username, '')"],
      ]) {
        const value = queryText(raw, 255);
        if (value) { where.push(`${expression} LIKE ?`); params.push(`%${value}%`); }
      }
      const bookedFrom = queryDate(req.query?.bookedFrom ?? req.query?.booked_from);
      const bookedTo = queryDate(req.query?.bookedTo ?? req.query?.booked_to);
      if (bookedFrom) { where.push('b.booked_at >= ?'); params.push(`${bookedFrom} 00:00:00`); }
      if (bookedTo) { where.push('b.booked_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(bookedTo); }
      const startsFrom = queryDate(req.query?.startsFrom ?? req.query?.starts_from);
      const startsTo = queryDate(req.query?.startsTo ?? req.query?.starts_to);
      if (startsFrom) { where.push('s.starts_at >= ?'); params.push(`${startsFrom} 00:00:00`); }
      if (startsTo) { where.push('s.starts_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(startsTo); }
      const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `SELECT b.*, s.code AS session_code, s.title AS session_title, s.starts_at, s.ends_at, s.location,
                s.booking_open_at, s.booking_close_at, s.booking_open_minutes_before,
                s.booking_close_minutes_before, s.cancel_close_minutes_before,
                s.redeem_open_at, s.redeem_close_at, s.redeem_open_minutes_before,
                s.redeem_close_minutes_after, s.settings_snapshot_json,
                rs.redeem_open_minutes_before AS scenario_redeem_open_minutes_before,
                rs.redeem_close_minutes_after AS scenario_redeem_close_minutes_after,
                sap.redeem_open_minutes_before AS allowed_redeem_open_minutes_before,
                sap.redeem_close_minutes_after AS allowed_redeem_close_minutes_after,
                COALESCE(s.coach_name, coach.username, '') AS coach_name,
                t.code AS ticket_code, COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses,
                t.product_redemption_policy_snapshot,
                p.id AS product_id,
                COALESCE(t.product_name_snapshot, tp.name, p.name, s.title) AS product_name,
                s.owner_user_id, provider.username AS provider_name
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
           LEFT JOIN course_tickets t ON t.id = b.ticket_id
           LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
           LEFT JOIN course_products p ON p.id = COALESCE(t.product_id, s.product_id)
           LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
           LEFT JOIN course_scenario_allowed_products sap
             ON sap.scenario_id = s.scenario_id
            AND sap.ticket_product_id = t.ticket_product_id
           LEFT JOIN users coach ON coach.id = s.coach_user_id
           LEFT JOIN users provider ON provider.id = s.owner_user_id
          ${filterSql} ORDER BY s.starts_at DESC, b.id DESC LIMIT ?${paging.paged ? ' OFFSET ?' : ''}`,
        paging.paged ? [...params, paging.limit, paging.offset] : [...params, 1000]
      );
      let items = courseV2.enabled
        ? await enrichCourseBookingPolicies(rows)
        : rows.map(toCourseBooking);
      if (courseV2.enabled) {
        const coachOnly = String(req.courseV2Membership?.role || '').toLowerCase() === 'coach';
        items = items.map((item) => ({
          ...item,
          capabilities: {
            ...item.capabilities,
            noShow: Boolean(
              item.capabilities?.noShow
              && (!coachOnly || Date.now() <= Number(item.policy?.redeemCloseAt))
            ),
            makeupRedeem: Boolean(item.capabilities?.makeupRedeem && !coachOnly),
          },
        }));
      }
      if (!paging.paged) return ok(res, items);
      const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total FROM course_bookings b JOIN course_sessions s ON s.id = b.session_id
          LEFT JOIN course_tickets t ON t.id = b.ticket_id
          LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
          LEFT JOIN course_products p ON p.id = COALESCE(t.product_id, s.product_id)
          LEFT JOIN course_redeem_scenarios rs ON rs.id = s.scenario_id
          LEFT JOIN users coach ON coach.id = s.coach_user_id
          LEFT JOIN users provider ON provider.id = s.owner_user_id ${filterSql}`,
        params
      );
      const summaryWhere = [];
      const summaryParams = [];
      appendManagerOwnerScope(req, 's', summaryWhere, summaryParams, { allowAdminFilters: false });
      const [summaryRows] = await pool.query(
        `SELECT b.status, COUNT(*) AS total
           FROM course_bookings b
           JOIN course_sessions s ON s.id = b.session_id
          ${summaryWhere.length ? `WHERE ${summaryWhere.join(' AND ')}` : ''} GROUP BY b.status`,
        summaryParams
      );
      const byStatus = Object.fromEntries(summaryRows.map((row) => [row.status, Number(row.total || 0)]));
      const summary = { total: Object.values(byStatus).reduce((sum, value) => sum + value, 0), byStatus };
      return ok(res, pagedEnvelope(items, { total: countRow?.total, ...paging, summary }));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_BOOKINGS_LIST_FAIL', error);
    }
  });

  router.get('/admin/courses/bookings/:id', courseManagerRequired, async (req, res) => {
    try {
      await ensureSchema();
      const booking = await findCourseBookingForRedemption(pool, {
        id: req.params.id,
        manager: req,
      });
      if (!booking) return fail(res, 'COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
      if (courseV2.enabled) {
        const [item] = await enrichCourseBookingPolicies([booking]);
        const coachOnly = String(req.courseV2Membership?.role || '').toLowerCase() === 'coach';
        return ok(res, {
          ...item,
          capabilities: {
            ...item.capabilities,
            noShow: Boolean(
              item.capabilities?.noShow
              && (!coachOnly || Date.now() <= Number(item.policy?.redeemCloseAt))
            ),
            makeupRedeem: Boolean(item.capabilities?.makeupRedeem && !coachOnly),
          },
        });
      }
      return ok(res, toCourseBooking(booking));
    } catch (error) {
      return handleError(res, 'ADMIN_COURSE_BOOKING_READ_FAIL', error);
    }
  });

  router.patch('/admin/courses/bookings/:id/status', courseManagerRequired, async (req, res) => {
    const status = normalizeStatus(req.body?.status, new Set(['booked', 'cancelled', 'no_show']), '');
    if (!status) return fail(res, 'VALIDATION_ERROR', '預約狀態不正確', 400);
    if (courseV2.enabled) {
      if (status === 'booked') {
        return fail(res, 'COURSE_COMPENSATING_EVENT_REQUIRED', '請使用撤銷操作回復預約，不能直接覆寫狀態', 409);
      }
      try {
        await courseV2.assertSchema();
        await assertCourseV2BookingActionScope(req, req.params.id);
        const result = await courseV2.attendanceAction({
          bookingId: req.params.id,
          action: status === 'no_show' ? 'no-show' : 'excused-leave',
          actorUserId: req.user.id,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
          note: req.body?.note,
        });
        return ok(res, result, '課程預約狀態已更新');
      } catch (error) {
        return handleError(res, 'ADMIN_COURSE_BOOKING_STATUS_FAIL', error);
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const booking = await findCourseBookingForRedemption(conn, {
        id: req.params.id,
        manager: req,
        forUpdate: true,
      });
      if (!booking) return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_FOUND', '找不到課程預約', 404);
      if (booking.status === 'attended') return rollbackFail(conn, res, 'COURSE_BOOKING_STATUS_LOCKED', '已核銷預約不能變更狀態', 409);
      const [result] = await conn.query(
        `UPDATE course_bookings b JOIN course_tickets t ON t.id = b.ticket_id JOIN course_products p ON p.id = t.product_id
            SET b.status = ?, b.cancelled_at = IF(? = 'cancelled', NOW(), NULL)
          WHERE b.id = ?${isGlobalCourseManager(req.user) ? '' : ' AND p.owner_user_id = ?'}`,
        [status, status, booking.id, ...(!isGlobalCourseManager(req.user) ? [req.user.id] : [])]
      );
      if (!result.affectedRows && String(booking.status) !== status) {
        return rollbackFail(conn, res, 'COURSE_BOOKING_UPDATE_CONFLICT', '預約租戶或狀態已變更，請重新載入', 409);
      }
      await conn.commit();
      return ok(res, { id: Number(booking.id), status }, '課程預約狀態已更新');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_BOOKING_STATUS_FAIL', error);
    } finally {
      conn.release();
    }
  });

  async function findCourseBookingForRedemption(queryable, {
    id = null,
    code = '',
    forUpdate = false,
    manager = null,
  } = {}) {
    const bookingId = positiveInt(id);
    const verifyCode = normalizeCourseBookingVerificationCode(code);
    if (!bookingId && !verifyCode) return null;
    const scopedManager = manager && !isGlobalCourseManager(manager.user);
    const assignedCoachOnly = scopedManager
      && courseV2.enabled
      && manager.courseV2Membership?.role === 'coach';
    const [rows] = await queryable.query(
      `SELECT b.*, s.code AS session_code, s.title AS session_title, s.starts_at, s.ends_at, s.location,
              s.status AS session_status, s.coach_user_id, COALESCE(s.coach_name, coach.username, '') AS coach_name,
              t.code AS ticket_code, COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses,
              t.status AS ticket_status, t.activated_at,
              t.activation_deadline, t.expires_at AS ticket_expires_at,
              p.id AS product_id,
              COALESCE(t.product_name_snapshot, tp.name, p.name, s.title) AS product_name,
              COALESCE(t.product_valid_days_snapshot, tp.valid_days, p.valid_days) AS valid_days,
              s.owner_user_id,
              provider.username AS provider_name
         FROM course_bookings b
         JOIN course_sessions s ON s.id = b.session_id
         LEFT JOIN course_tickets t ON t.id = b.ticket_id
         LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
         LEFT JOIN course_products p ON p.id = COALESCE(t.product_id, s.product_id)
         LEFT JOIN users coach ON coach.id = s.coach_user_id
         LEFT JOIN users provider ON provider.id = s.owner_user_id
        WHERE ${bookingId ? 'b.id = ?' : 'b.verify_code = ?'}
          ${scopedManager ? 'AND s.owner_user_id = ?' : ''}
          ${assignedCoachOnly
    ? `AND (
          s.coach_user_id = ?
          OR EXISTS (
            SELECT 1 FROM course_coach_profiles scoped_coach
             WHERE scoped_coach.id = s.coach_profile_id AND scoped_coach.user_id = ?
          )
        )`
    : ''}
        LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
      [
        bookingId || verifyCode,
        ...(scopedManager ? [manager.courseV2OwnerUserId || manager.user.id] : []),
        ...(assignedCoachOnly ? [manager.user.id, manager.user.id] : []),
      ]
    );
    return rows[0] || null;
  }

  function toCourseRedemptionPreview(booking) {
    return {
      needsConfirmation: true,
      code: booking.verify_code,
      booking: {
        id: Number(booking.id),
        verifyCode: booking.verify_code,
        sessionId: Number(booking.session_id),
        sessionCode: booking.session_code,
        sessionTitle: booking.session_title,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        location: booking.location || '',
        attendeeName: booking.attendee_name,
        attendeeEmail: booking.attendee_email,
        ticketCode: booking.ticket_code,
        productName: booking.product_name,
        remainingUses: Number(booking.remaining_uses),
        status: booking.status,
      },
    };
  }

  async function redeemCourseBooking(conn, booking, staffUserId, note = '', manager = null) {
    const blockReason = courseBookingRedemptionBlockReason(booking);
    if (blockReason) {
      const code = String(booking?.status || '').toLowerCase() === 'booked'
        ? 'COURSE_TICKET_UNAVAILABLE'
        : 'COURSE_BOOKING_NOT_REDEEMABLE';
      return { error: [code, blockReason, 409] };
    }
    const activatedAt = booking.activated_at || mysqlDateTime(new Date());
    const expiresAt = booking.ticket_expires_at
      || courseCalendarDate(new Date(Date.now() + Number(booking.valid_days || 120) * 86400000));
    const remaining = Number(booking.remaining_uses) - 1;
    const nextStatus = remaining <= 0 ? 'exhausted' : 'active';
    const [ticketResult] = await conn.query(
      `UPDATE course_tickets t JOIN course_products p ON p.id = t.product_id
          SET t.remaining_uses = ?, t.status = ?, t.activated_at = ?, t.expires_at = ?
        WHERE t.id = ? AND t.remaining_uses = ? AND t.status = ?
          ${manager && !isGlobalCourseManager(manager.user) ? 'AND p.owner_user_id = ?' : ''}`,
      [remaining, nextStatus, activatedAt, expiresAt, booking.ticket_id, booking.remaining_uses, booking.ticket_status,
        ...(manager && !isGlobalCourseManager(manager.user) ? [manager.user.id] : [])]
    );
    if (!ticketResult.affectedRows) return { error: ['COURSE_REDEMPTION_CONFLICT', '票券狀態已變更，請重新掃描', 409] };
    const [bookingResult] = await conn.query(
      `UPDATE course_bookings b JOIN course_tickets t ON t.id = b.ticket_id JOIN course_products p ON p.id = t.product_id
          SET b.status = 'attended', b.attended_at = NOW()
        WHERE b.id = ? AND b.status = 'booked'
          ${manager && !isGlobalCourseManager(manager.user) ? 'AND p.owner_user_id = ?' : ''}`,
      [booking.id, ...(manager && !isGlobalCourseManager(manager.user) ? [manager.user.id] : [])]
    );
    if (!bookingResult.affectedRows) return { error: ['COURSE_REDEMPTION_CONFLICT', '預約已核銷或狀態已變更', 409] };
    try {
      await conn.query(
        `INSERT INTO course_attendance_logs (session_id, booking_id, ticket_id, user_id, action, quantity, staff_user_id, note)
         VALUES (?, ?, ?, ?, 'redeem', 1, ?, ?)`,
        [booking.session_id, booking.id, booking.ticket_id, booking.user_id, staffUserId, text(note, 500) || null]
      );
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return { error: ['COURSE_REDEMPTION_CONFLICT', '此課程預約已完成核銷', 409] };
      }
      throw error;
    }
    return { remainingUses: remaining, ticketStatus: nextStatus, bookingId: Number(booking.id) };
  }

  router.post('/admin/courses/bookings/progress_scan', courseManagerRequired, async (req, res) => {
    const code = normalizeCourseBookingVerificationCode(req.body?.code);
    if (!isCourseBookingVerificationCode(code)) return fail(res, 'VALIDATION_ERROR', '無效的課程核銷碼', 400);
    const confirm = booleanFlag(
      req.body?.confirm ?? req.body?.confirmed ?? req.body?.confirmProgress,
      false
    );
    if (courseV2.enabled) {
      try {
        await courseV2.assertSchema();
        const [bookingRows] = await pool.query(
          `SELECT b.id, b.verify_code, b.status, b.row_version, b.attendee_name, b.attendee_email,
                  b.session_id, s.code AS session_code, s.title AS session_title,
                  s.starts_at, s.ends_at, s.location,
                  t.code AS ticket_code,
                  COALESCE(t.product_name_snapshot, tp.name, p.name, '') AS product_name,
                  COALESCE(t.remaining_uses_cache, t.remaining_uses, 0) AS remaining_uses
             FROM course_bookings b
             JOIN course_sessions s ON s.id = b.session_id
             LEFT JOIN course_tickets t ON t.id = b.ticket_id
             LEFT JOIN course_ticket_products tp ON tp.id = t.ticket_product_id
             LEFT JOIN course_products p ON p.id = t.product_id
            WHERE b.verify_code = ? LIMIT 1`,
          [code]
        );
        const booking = bookingRows[0];
        if (!booking) return fail(res, 'COURSE_BOOKING_NOT_FOUND', '找不到此課程預約', 404);
        const scope = await assertCourseV2BookingActionScope(req, booking.id);
        const [enriched] = await enrichCourseBookingPolicies([booking]);
        const { policy, pendingReview } = enriched;
        const capabilities = {
          ...enriched.capabilities,
          noShow: Boolean(
            enriched.capabilities?.noShow
            && (
              Date.now() <= Number(policy.redeemCloseAt)
              || scope.membershipRole !== 'coach'
            )
          ),
          makeupRedeem: Boolean(
            enriched.capabilities?.makeupRedeem
            && scope.membershipRole !== 'coach'
          ),
        };
        if (!confirm) {
          if (!capabilities.attend) {
            return fail(
              res,
              'COURSE_BOOKING_NOT_REDEEMABLE',
              pendingReview ? '已超過現場核銷時間，請使用補登流程' : '目前不在現場核銷時間窗',
              409
            );
          }
          return ok(res, {
            needsConfirmation: true,
            code,
            booking: {
              id: Number(booking.id),
              verifyCode: booking.verify_code,
              sessionId: Number(booking.session_id),
              sessionCode: booking.session_code,
              sessionTitle: booking.session_title,
              startsAt: booking.starts_at,
              endsAt: booking.ends_at,
              location: booking.location || '',
              attendeeName: booking.attendee_name,
              attendeeEmail: booking.attendee_email,
              ticketCode: booking.ticket_code,
              productName: booking.product_name,
              remainingUses: Number(booking.remaining_uses),
              status: booking.status,
              rowVersion: Number(booking.row_version || 1),
              pendingReview,
              capabilities,
            },
            policy,
          });
        }
        const result = await courseV2.attendanceAction({
          bookingId: booking.id,
          action: 'attend',
          actorUserId: req.user.id,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
          note: req.body?.note,
        });
        return ok(res, result, 'QR Code 核銷完成並扣除 1 堂');
      } catch (error) {
        return handleError(
          res,
          confirm ? 'ADMIN_COURSE_SCAN_CONFIRM_FAIL' : 'ADMIN_COURSE_SCAN_PREVIEW_FAIL',
          error
        );
      }
    }
    if (!confirm) {
      try {
        await ensureSchema();
        const booking = await findCourseBookingForRedemption(pool, { code, manager: req });
        if (!booking) return fail(res, 'COURSE_BOOKING_NOT_FOUND', '找不到此課程預約', 404);
        const blockReason = courseBookingRedemptionBlockReason(booking);
        if (blockReason) return fail(res, 'COURSE_BOOKING_NOT_REDEEMABLE', blockReason, 409);
        return ok(res, toCourseRedemptionPreview(booking));
      } catch (error) {
        return handleError(res, 'ADMIN_COURSE_SCAN_PREVIEW_FAIL', error);
      }
    }

    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const booking = await findCourseBookingForRedemption(conn, { code, forUpdate: true, manager: req });
      if (!booking) return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_FOUND', '找不到此課程預約', 404);
      const result = await redeemCourseBooking(conn, booking, req.user.id, req.body?.note, req);
      if (result.error) return rollbackFail(conn, res, ...result.error);
      await conn.commit();
      return ok(res, result, 'QR Code 核銷完成並扣除 1 堂');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_SCAN_CONFIRM_FAIL', error);
    } finally {
      conn.release();
    }
  });

  router.post('/admin/courses/bookings/:id/attend', courseManagerRequired, async (req, res) => {
    if (courseV2.enabled) {
      try {
        await courseV2.assertSchema();
        await assertCourseV2BookingActionScope(req, req.params.id);
        const result = await courseV2.attendanceAction({
          bookingId: req.params.id,
          action: 'attend',
          actorUserId: req.user.id,
          idempotencyKey: courseV2.mutationKeyFromRequest(req),
          expectedRowVersion: courseV2.rowVersionFromRequest(req),
          note: req.body?.note,
        });
        return ok(res, result, '出席已核銷並扣除 1 堂');
      } catch (error) {
        return handleError(res, 'ADMIN_COURSE_ATTEND_FAIL', error);
      }
    }
    const conn = await pool.getConnection();
    try {
      await ensureSchema();
      await conn.beginTransaction();
      const booking = await findCourseBookingForRedemption(conn, { id: req.params.id, forUpdate: true, manager: req });
      if (!booking) return rollbackFail(conn, res, 'COURSE_BOOKING_NOT_FOUND', '找不到此課程預約', 404);
      const result = await redeemCourseBooking(conn, booking, req.user.id, req.body?.note, req);
      if (result.error) return rollbackFail(conn, res, ...result.error);
      await conn.commit();
      return ok(res, result, '出席已核銷並扣除 1 堂');
    } catch (error) {
      try { await conn.rollback(); } catch (_) {}
      return handleError(res, 'ADMIN_COURSE_ATTEND_FAIL', error);
    } finally {
      conn.release();
    }
  });

  return router;
}

buildCourseRoutes.ensureCourseTables = ensureCourseTables;
buildCourseRoutes.ensureCourseTicketTransferWorkflowSchema = ensureCourseTicketTransferWorkflowSchema;
buildCourseRoutes.helpers = {
  text,
  positiveInt,
  nonNegativeInt,
  money,
  booleanFlag,
  mysqlDateTime,
  dateOnly,
  courseCalendarDate,
  addCourseCalendarDays,
  normalizeStatus,
  normalizeCourseCoverUrl,
  normalizeCourseTransferEmail,
  courseUserDataConfirmationMatches,
  escapeCourseEmailHtml,
  formatCourseEmailAmount,
  formatCourseEmailDateTime,
  buildCourseNotificationEmail,
  buildCourseOrderConfirmationEmail,
  buildCourseBookingConfirmationEmail,
  courseTicketTransferBlockReason,
  courseBookingRedemptionBlockReason,
  courseBookingGoogleWalletValidity,
  isCourseTicketTransferCode,
  isCourseTicketTransferExpired,
  normalizeCourseBookingVerificationCode,
  isCourseBookingVerificationCode,
  toCourseTicketTransferLog,
  toProduct,
  toSession,
  toTicket,
  toCourseTicketRedemptionBooking,
  attachCourseTicketRedemptionBookings,
  buildCourseProductCoverStoragePath,
  ensureCourseTicketTransferWorkflowColumns,
  ensureCourseBookingVerificationSchema,
  backfillCourseTicketTransferLogsForRelatedUser,
};

module.exports = buildCourseRoutes;
