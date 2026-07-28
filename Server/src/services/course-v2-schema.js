const COURSE_V2_SCHEMA_VERSION = '049_course_count_card_normalization';

class CourseV2SchemaError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'CourseV2SchemaError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function environmentFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

async function loadCourseSchemaVersion(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT version FROM course_schema_versions WHERE version = ? LIMIT 1',
      [COURSE_V2_SCHEMA_VERSION]
    );
    return rows?.[0]?.version || null;
  } catch (error) {
    throw new CourseV2SchemaError(
      'COURSE_V2_SCHEMA_MISSING',
      `課程資料庫尚未套用 migration ${COURSE_V2_SCHEMA_VERSION}`,
      error
    );
  }
}

async function loadCourseCutoverState(pool) {
  try {
    const [rows] = await pool.query(
      'SELECT state, schema_version FROM course_v2_cutover_state WHERE id = 1 LIMIT 1'
    );
    return rows?.[0] || null;
  } catch (error) {
    throw new CourseV2SchemaError(
      'COURSE_V2_CUTOVER_STATE_MISSING',
      '找不到課程 V2 切換狀態，請先完成 migration 與 GAS 對帳',
      error
    );
  }
}

async function assertCourseV2StartupSchema(pool, {
  enabled = environmentFlag(process.env.COURSE_V2_ENABLED, false),
} = {}) {
  if (!pool || typeof pool.query !== 'function') {
    throw new CourseV2SchemaError('COURSE_V2_SCHEMA_CHECK_INVALID', '課程 schema 檢核缺少資料庫連線');
  }

  const version = await loadCourseSchemaVersion(pool);
  if (version !== COURSE_V2_SCHEMA_VERSION) {
    throw new CourseV2SchemaError(
      'COURSE_V2_SCHEMA_MISSING',
      `課程資料庫尚未套用 migration ${COURSE_V2_SCHEMA_VERSION}`
    );
  }

  const cutover = await loadCourseCutoverState(pool);
  const state = String(cutover?.state || '').trim().toLowerCase();

  if (!enabled) {
    if (state === 'active') {
      throw new CourseV2SchemaError(
        'COURSE_V2_RUNTIME_MISMATCH',
        '資料庫已切換為課程 V2，但此服務尚未啟用 COURSE_V2_ENABLED'
      );
    }
    return {
      enabled: false,
      schemaVersion: version,
      cutoverState: state || 'legacy',
    };
  }

  if (cutover?.schema_version !== COURSE_V2_SCHEMA_VERSION || state !== 'active') {
    throw new CourseV2SchemaError(
      'COURSE_V2_CUTOVER_NOT_ACTIVE',
      'COURSE_V2_ENABLED 已開啟，但 GAS 匯入與 reconciliation 尚未完成 active 切換'
    );
  }

  return {
    enabled: true,
    schemaVersion: version,
    cutoverState: state,
  };
}

module.exports = {
  COURSE_V2_SCHEMA_VERSION,
  CourseV2SchemaError,
  environmentFlag,
  loadCourseSchemaVersion,
  loadCourseCutoverState,
  assertCourseV2StartupSchema,
};
