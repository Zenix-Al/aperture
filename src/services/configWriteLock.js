import { CONFIG_STORAGE_KEYS } from "../config/persistence.js";

/** Origin-scoped serialization. No storage lease can safely replace Web Locks. */
export function withConfigWriteLock(operation, {
  lockManager = globalThis.navigator?.locks,
  secureContext = globalThis.isSecureContext,
} = {}) {
  if (secureContext !== true) return Promise.reject(new Error("config_secure_context_required"));
  if (typeof lockManager?.request !== "function") return Promise.reject(new Error("config_lock_unavailable"));
  return lockManager.request(`${CONFIG_STORAGE_KEYS.current}:write`, { mode: "exclusive" }, async (lock) => {
    if (!lock) throw new Error("config_lock_unavailable");
    return operation();
  });
}
