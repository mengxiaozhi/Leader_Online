const ctx = require('./src/context');
const buildRouter = require('./src/router');
const {
  startGoogleWalletObjectSyncWorker,
} = require('./src/services/google-wallet-object-sync');
const {
  startStorageFileCleanupWorker,
} = require('./src/services/storage-file-cleanup');
const {
  assertCourseV2StartupSchema,
} = require('./src/services/course-v2-schema');
const {
  startCourseV2Worker,
} = require('./src/services/course-v2-worker');

const router = buildRouter(ctx);
ctx.app.use(router);

// Global error handler
ctx.app.use((err, req, res, next) => {
  console.error('UnhandledError:', err);
  return ctx.fail(res, 'UNHANDLED', '系統發生未預期錯誤', 500);
});

const port = process.env.PORT || 3020;
let server = null;
let googleWalletSyncWorker = null;
let storageFileCleanupWorker = null;
let courseV2Worker = null;

async function start() {
  const courseSchema = await assertCourseV2StartupSchema(ctx.pool);
  if (courseSchema.degraded) {
    console.warn(
      `⚠️ Course V2 schema pending [${courseSchema.warningCode}]; `
      + `starting legacy runtime (${courseSchema.cutoverState})`
    );
  } else {
    console.log(
      `✅ Course schema ${courseSchema.schemaVersion} ready (${courseSchema.cutoverState})`
    );
  }
  googleWalletSyncWorker = startGoogleWalletObjectSyncWorker({ pool: ctx.pool });
  storageFileCleanupWorker = startStorageFileCleanupWorker({
    pool: ctx.pool,
    storage: ctx.storage,
  });
  courseV2Worker = startCourseV2Worker({ pool: ctx.pool });
  server = ctx.app.listen(port, () => {
    console.log(`\ud83d\ude80 Server running on http://localhost:${port}`);
  });
}

function shutdown() {
  console.log('\ud83d\udeab Shutting down...');
  googleWalletSyncWorker?.stop();
  storageFileCleanupWorker?.stop();
  courseV2Worker?.stop();
  if (!server) {
    return ctx.pool.end().finally(() => process.exit(0));
  }
  return server.close(() => {
    ctx.pool.end().then(() => {
      console.log('\u2705 DB pool closed. Bye.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((error) => {
  console.error(`❌ Server startup failed [${error?.code || 'STARTUP_ERROR'}]:`, error?.message || error);
  ctx.pool.end().finally(() => {
    process.exitCode = 1;
  });
});
