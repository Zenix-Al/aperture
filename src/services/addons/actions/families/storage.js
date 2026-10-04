import { getAddonStorageKey } from "../../../../config/persistence.js";
import { storageAdapter } from "../../../storageAdapter.js";
import { defineAction } from "../contract.js";

export async function actionStorageGet(addonId, payload, ensureAddonStateBucket, persistAddonsState, reauthorize) {
  const key = String(payload?.key || "").trim();
  if (!key) return { ok: false, reason: "key_required" };
  if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 128) return { ok: false, reason: "invalid_key" };
  const stateBucket = ensureAddonStateBucket(addonId);
  if (Object.hasOwn(stateBucket, key)) return { ok: true, value: stateBucket[key] };
  try {
    const legacyValue = await storageAdapter.get(getAddonStorageKey(addonId, key), undefined);
    if (typeof legacyValue !== "undefined") {
      const revoked = reauthorize?.();
      if (revoked) return { ok: false, reason: revoked };
      stateBucket[key] = legacyValue;
      const persisted = await persistAddonsState();
      if (!persisted.ok) return { ok: false, reason: persisted.reason || "storage_write_failed" };
      return { ok: true, value: legacyValue };
    }
    return { ok: true, value: payload?.defaultValue ?? null };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export async function actionStorageSet(
  addonId, payload, measurePayloadBytes, maxValueBytes, maxTotalBytes,
  ensureAddonStateBucket, persistAddonsState,
) {
  const key = String(payload?.key || "").trim();
  if (!key) return { ok: false, reason: "key_required" };
  if (["__proto__", "constructor", "prototype"].includes(key) || key.length > 128) return { ok: false, reason: "invalid_key" };
  const newValue = payload?.value ?? null;
  if (measurePayloadBytes(newValue) > maxValueBytes) return { ok: false, reason: "payload_too_large" };
  const stateBucket = ensureAddonStateBucket(addonId);
  const hadKey = Object.hasOwn(stateBucket, key);
  const previousValue = hadKey ? stateBucket[key] : undefined;
  stateBucket[key] = newValue;
  if (measurePayloadBytes(stateBucket) > maxTotalBytes) {
    if (hadKey) stateBucket[key] = previousValue;
    else delete stateBucket[key];
    return { ok: false, reason: "quota_exceeded" };
  }
  const persisted = await persistAddonsState();
  if (!persisted.ok) {
    if (hadKey) stateBucket[key] = previousValue;
    else delete stateBucket[key];
    return { ok: false, reason: persisted.reason || "storage_write_failed" };
  }
  return { ok: true };
}

export function actionStorageGetUsage(addonId, measurePayloadBytes, valueLimit, totalLimit, ensureAddonStateBucket) {
  const stateBucket = ensureAddonStateBucket(addonId);
  return { ok: true, value: {
    valueCount: Object.keys(stateBucket).length,
    estimatedBytes: measurePayloadBytes(stateBucket),
    valueLimitBytes: valueLimit,
    totalLimitBytes: totalLimit,
  } };
}

export const storageActions = Object.freeze([
  defineAction({
    id: "storage.get", requiredCapabilities: ["storage"],
    execute: ({ addonId, payload, deps, reauthorize }) => actionStorageGet(
      addonId, payload, deps.ensureAddonStateBucket, deps.persistAddonsState, reauthorize,
    ),
  }),
  defineAction({
    id: "storage.set", requiredCapabilities: ["storage"],
    execute: ({ addonId, payload, deps, limits }) => actionStorageSet(
      addonId, payload, deps.measurePayloadBytes, limits.maxAddonStorageValueBytes,
      limits.maxAddonStorageTotalBytes, deps.ensureAddonStateBucket, deps.persistAddonsState,
    ),
  }),
  defineAction({
    id: "storage.getUsage", requiredCapabilities: ["storage"],
    execute: ({ addonId, deps, limits }) => actionStorageGetUsage(
      addonId, deps.measurePayloadBytes, limits.maxAddonStorageValueBytes,
      limits.maxAddonStorageTotalBytes, deps.ensureAddonStateBucket,
    ),
  }),
]);
