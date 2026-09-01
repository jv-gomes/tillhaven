import Redis from 'ioredis';
import { env } from '../env.js';

/** Sessions, rate limiting, and short-lived locks (CLAUDE.md §2). */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  lazyConnect: true,
});

let connected = false;

export async function connectRedis(): Promise<void> {
  if (connected) return;
  await redis.connect();
  connected = true;
}

export async function pingRedis(): Promise<boolean> {
  try {
    if (!connected) await connectRedis();
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (connected) await redis.quit();
  connected = false;
}
