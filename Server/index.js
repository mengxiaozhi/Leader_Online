const ctx = require('./src/context');
const buildRouter = require('./src/router');

const router = buildRouter(ctx);
ctx.app.use(router);

// Global error handler
ctx.app.use((err, req, res, next) => {
  console.error('UnhandledError:', err);
  return ctx.fail(res, 'UNHANDLED', '系統發生未預期錯誤', 500);
});

const port = process.env.PORT || 3020;
const server = ctx.app.listen(port, () => {
  console.log(`\ud83d\ude80 Server running on http://localhost:${port}`);
});

function shutdown() {
  console.log('\ud83d\udeab Shutting down...');
  server.close(() => {
    ctx.pool.end().then(() => {
      console.log('\u2705 DB pool closed. Bye.');
      process.exit(0);
    });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
