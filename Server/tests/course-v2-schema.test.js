const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COURSE_V2_SCHEMA_VERSION,
  CourseV2SchemaError,
  environmentFlag,
  assertCourseV2StartupSchema,
} = require('../src/services/course-v2-schema');

function poolReturning({
  version = COURSE_V2_SCHEMA_VERSION,
  state = 'active',
  cutoverVersion = version,
  versionError = null,
  cutoverError = null,
} = {}) {
  return {
    async query(sql) {
      if (sql.startsWith('SELECT version FROM course_schema_versions')) {
        if (versionError) throw versionError;
        return [[version ? { version } : undefined].filter(Boolean)];
      }
      if (sql.startsWith('SELECT state, schema_version FROM course_v2_cutover_state')) {
        if (cutoverError) throw cutoverError;
        return [[{ state, schema_version: cutoverVersion }]];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('course V2 environment flag accepts only explicit truthy values', () => {
  assert.equal(environmentFlag(undefined), false);
  assert.equal(environmentFlag('0'), false);
  assert.equal(environmentFlag('false'), false);
  assert.equal(environmentFlag('1'), true);
  assert.equal(environmentFlag('TRUE'), true);
});

test('completed migration permits legacy cutover when V2 is disabled', async () => {
  const result = await assertCourseV2StartupSchema(poolReturning({ state: 'legacy' }), { enabled: false });
  assert.deepEqual(result, {
    enabled: false,
    schemaVersion: COURSE_V2_SCHEMA_VERSION,
    schemaReady: true,
    cutoverState: 'legacy',
    degraded: false,
  });
});

test('legacy runtime refuses to start after the database cutover is active', async () => {
  await assert.rejects(
    assertCourseV2StartupSchema(poolReturning({ state: 'active' }), { enabled: false }),
    (error) => (
      error instanceof CourseV2SchemaError
      && error.code === 'COURSE_V2_RUNTIME_MISMATCH'
    )
  );
});

test('course V2 startup requires an active cutover with the same schema version', async () => {
  await assert.rejects(
    assertCourseV2StartupSchema(poolReturning({ state: 'ready' }), { enabled: true }),
    (error) => error instanceof CourseV2SchemaError && error.code === 'COURSE_V2_CUTOVER_NOT_ACTIVE'
  );
  await assert.rejects(
    assertCourseV2StartupSchema(poolReturning({ state: 'active', cutoverVersion: '048' }), { enabled: true }),
    (error) => error instanceof CourseV2SchemaError && error.code === 'COURSE_V2_CUTOVER_NOT_ACTIVE'
  );

  const result = await assertCourseV2StartupSchema(poolReturning(), { enabled: true });
  assert.equal(result.enabled, true);
  assert.equal(result.schemaReady, true);
  assert.equal(result.cutoverState, 'active');
  assert.equal(result.degraded, false);
});

test('legacy startup stays available while migration marker is absent', async () => {
  const result = await assertCourseV2StartupSchema(
    poolReturning({ version: null, state: 'legacy' }),
    { enabled: false }
  );
  assert.deepEqual(result, {
    enabled: false,
    schemaVersion: null,
    schemaReady: false,
    cutoverState: 'legacy',
    degraded: true,
    warningCode: 'COURSE_V2_SCHEMA_MISSING',
  });
});

test('enabled course V2 startup still fails when the migration marker is absent', async () => {
  await assert.rejects(
    assertCourseV2StartupSchema(poolReturning({ version: null }), { enabled: true }),
    (error) => error instanceof CourseV2SchemaError && error.code === 'COURSE_V2_SCHEMA_MISSING'
  );
});

test('legacy startup only tolerates missing V2 schema objects, not database outages', async () => {
  const missingTable = Object.assign(new Error('missing table'), { code: 'ER_NO_SUCH_TABLE' });
  const missingResult = await assertCourseV2StartupSchema(
    poolReturning({
      versionError: missingTable,
      cutoverError: missingTable,
    }),
    { enabled: false }
  );
  assert.equal(missingResult.degraded, true);
  assert.equal(missingResult.schemaReady, false);

  const connectionFailure = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
  await assert.rejects(
    assertCourseV2StartupSchema(
      poolReturning({ versionError: connectionFailure }),
      { enabled: false }
    ),
    (error) => (
      error instanceof CourseV2SchemaError
      && error.code === 'COURSE_V2_SCHEMA_MISSING'
      && error.cause === connectionFailure
    )
  );
});

test('legacy startup refuses an active cutover even when the marker is absent', async () => {
  await assert.rejects(
    assertCourseV2StartupSchema(
      poolReturning({ version: null, state: 'active' }),
      { enabled: false }
    ),
    (error) => (
      error instanceof CourseV2SchemaError
      && error.code === 'COURSE_V2_RUNTIME_MISMATCH'
    )
  );
});
