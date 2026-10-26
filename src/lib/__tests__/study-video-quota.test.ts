import { describe, expect, it } from "vitest";

import {
  VIDEO_QUOTA_STORAGE_PREFIX,
  readVideoQuotaReset,
  serverVideoResetAt,
  storeVideoQuotaReset,
  type QuotaStorage,
} from "../study-video-quota";

const NOW = Date.UTC(2026, 9, 26, 4, 10);
const USER_A = "00000000-0000-4000-8000-000000000001";
const USER_B = "00000000-0000-4000-8000-000000000002";

function memoryStorage(): QuotaStorage {
  const saved = new Map<string, string>();
  return {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => { saved.set(key, value); },
    removeItem: (key) => { saved.delete(key); },
  };
}

describe("video quota reset is advisory, scoped and safe", () => {
  it("accepts only positive, bounded reset intervals from the narrated video-start endpoint", () => {
    expect(serverVideoResetAt("/api/study-video/sequence-start", 429, 3600, NOW)).toBe(NOW + 3_600_000);
    expect(serverVideoResetAt("/api/study-video/sequence-start", 429, 86400, NOW)).toBe(NOW + 86_400_000);
    for (const rejected of [0, -1, 86401, "100", Infinity, NaN, 1.5, null, undefined]) {
      expect(serverVideoResetAt("/api/study-video/sequence-start", 429, rejected, NOW)).toBeNull();
    }
    expect(serverVideoResetAt("/api/study-video/sequence-start", 403, 400, NOW)).toBeNull();
    expect(serverVideoResetAt("/api/study-video/advance", 429, 400, NOW)).toBeNull();
  });

  it("stores reset only for its actual signed-in account and expires it", () => {
    const store = memoryStorage();
    storeVideoQuotaReset(USER_A, NOW + 40_000, NOW, store);
    expect(store.getItem(VIDEO_QUOTA_STORAGE_PREFIX + USER_A)).toBe(String(NOW + 40_000));
    expect(readVideoQuotaReset(USER_A, NOW, store)).toBe(NOW + 40_000);
    expect(readVideoQuotaReset(USER_B, NOW, store)).toBeNull();
    expect(readVideoQuotaReset(USER_A, NOW + 40_001, store)).toBeNull();
    expect(store.getItem(VIDEO_QUOTA_STORAGE_PREFIX + USER_A)).toBeNull();
  });

  it("rejects malformed user identities, corrupted storage and implausible reset dates", () => {
    const store = memoryStorage();
    storeVideoQuotaReset("anonymous", NOW + 1000, NOW, store);
    expect(readVideoQuotaReset("anonymous", NOW, store)).toBeNull();

    store.setItem(VIDEO_QUOTA_STORAGE_PREFIX + USER_A, "not a time");
    expect(readVideoQuotaReset(USER_A, NOW, store)).toBeNull();
    storeVideoQuotaReset(USER_A, NOW + 10 * 86400 * 1000, NOW, store);
    expect(readVideoQuotaReset(USER_A, NOW, store)).toBeNull();
  });

  it("remains optional when browser storage is unavailable", () => {
    storeVideoQuotaReset(USER_A, NOW + 1000, NOW, null);
    expect(readVideoQuotaReset(USER_A, NOW, null)).toBeNull();
  });
});
