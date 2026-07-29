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

function isMissingSchemaShapeError(error) {
  const code = error?.cause?.code || error?.code;
  return ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(code);
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

  let version = null;
  try {
    version = await loadCourseSchemaVersion(pool);
  } catch (error) {
    // Legacy mode does not read the normalized tables. Let unrelated APIs keep
    // serving while migration 049 is pending, but never hide a database
    // connectivity/authentication failure or weaken an enabled V2 runtime.
    if (enabled || !isMissingSchemaShapeError(error)) throw error;
  }

  if (version !== COURSE_V2_SCHEMA_VERSION) {
    if (enabled) {
      throw new CourseV2SchemaError(
        'COURSE_V2_SCHEMA_MISSING',
        `課程資料庫尚未套用 migration ${COURSE_V2_SCHEMA_VERSION}`
      );
    }

    let cutover = null;
    try {
      cutover = await loadCourseCutoverState(pool);
    } catch (error) {
      if (!isMissingSchemaShapeError(error)) throw error;
    }
    const state = String(cutover?.state || '').trim().toLowerCase();
    if (state === 'active') {
      throw new CourseV2SchemaError(
        'COURSE_V2_RUNTIME_MISMATCH',
        '資料庫已切換為課程 V2，但此服務尚未啟用 COURSE_V2_ENABLED'
      );
    }

    return {
      enabled: false,
      schemaVersion: null,
      schemaReady: false,
      cutoverState: state || 'legacy',
      degraded: true,
      warningCode: 'COURSE_V2_SCHEMA_MISSING',
    };
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
      schemaReady: true,
      cutoverState: state || 'legacy',
      degraded: false,
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
    schemaReady: true,
    cutoverState: state,
    degraded: false,
  };
}

module.exports = {
  COURSE_V2_SCHEMA_VERSION,
  CourseV2SchemaError,
  environmentFlag,
  isMissingSchemaShapeError,
  loadCourseSchemaVersion,
  loadCourseCutoverState,
  assertCourseV2StartupSchema,
};
