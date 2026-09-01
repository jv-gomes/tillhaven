import { buildApp } from './app.js';
import { env } from './env.js';
import { closeDb } from './db/client.js';
import { closeRedis } from './db/redis.js';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Tillhaven server listening on :${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      app.log.info(`${signal} received, shutting down`);
      await app.close();
      await Promise.allSettled([closeDb(), closeRedis()]);
      process.exit(0);
    })();
  });
}
