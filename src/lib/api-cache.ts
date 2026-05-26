import { Redis } from "@upstash/redis";

// trim 필수 — Cloud Secret Manager에 trailing \n이 박혀 들어오면 truthy로 평가되어
// 잘못된 URL/token으로 Redis 호출 → 매 요청 실패. (2026-04-29 사건 후 일괄 적용)
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
const redis = upstashUrl
  ? new Redis({ url: upstashUrl, token: upstashToken! })
  : null;

const memoryStore = new Map<string, { data: unknown; expiresAt: number }>();

export const apiCache = {
  async get<T>(key: string): Promise<T | null> {
    if (redis) {
      try {
        return await redis.get<T>(key);
      } catch {
        return null;
      }
    }
    const entry = memoryStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memoryStore.delete(key);
      return null;
    }
    return entry.data as T;
  },
  async set<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
    if (redis) {
      try {
        await redis.set(key, data, { ex: ttlSeconds });
      } catch {
        /* 캐시 저장 실패 무시 */
      }
      return;
    }
    memoryStore.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
  },
};

export const MOLIT_CACHE_TTL = 7 * 24 * 60 * 60; // 7일
export const GEO_CACHE_TTL = 30 * 24 * 60 * 60; // 30일
