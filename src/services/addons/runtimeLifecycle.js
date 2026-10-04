import policy from "aperture:addons";
import { getAddonState } from "./state.js";
import { updateAddonStatus } from "./registry.js";
import { debugLog } from "../../core/logger.js";
import { shutdownAddonsBridgeServer } from "./bridgeServer.js";
import { createAddonLifecycleOrchestrator } from "./lifecycle.js";
import { cleanupAddonObserverSubscriptions } from "./observer.js";
import {
  listRegisteredAddons,
  replaceRegisteredAddons,
  unregisterAddon as unregisterAddonFromRegistry,
} from "./registry.js";
import { ADDON_COMMAND_EVENT, sanitizeAddonId } from "./shared.js";
import { cleanupAddonUi, getAddonUiPolicySnapshot } from "./uiHost.js";
import extensions from "aperture:addon-extensions";

export const ADDON_TEARDOWN_WATCHDOG_MS = 1200;

export const addonLifecycle = createAddonLifecycleOrchestrator({
  sanitizeAddonId,
  listRegisteredAddons,
  cleanupAddonObserverSubscriptions,
  cleanupAddonUi,
  teardownWatchdogMs: ADDON_TEARDOWN_WATCHDOG_MS,
  eventName: ADDON_COMMAND_EVENT,
});

export function getAddonLifecycleSnapshot() {
  return addonLifecycle.getSnapshot();
}

export function notifyAllAddonsBeforePageChange() {
  extensions.lifecycle?.beforePageChange?.();
  addonLifecycle.notifyAllBeforePageChange();
}

export function shutdownAddonsService(reason = "runtime teardown") {
  extensions.lifecycle?.shutdown?.();
  suspendedAddonIds.clear();
  shutdownAddonsBridgeServer();
  const summary = addonLifecycle.shutdownAll(reason);
  replaceRegisteredAddons([]);
  return summary;
}

export function disableAddonsService() {
  extensions.lifecycle?.shutdown?.();
  suspendedAddonIds.clear();
  shutdownAddonsBridgeServer();
  for (const addon of listRegisteredAddons()) {
    if (addon?.id) addonLifecycle.requestTeardown(addon.id, "service-disabled");
  }
  replaceRegisteredAddons([]);
  return { ok: true };
}

export function unregisterAddon(addonId) {
  const normalizedId = sanitizeAddonId(addonId);
  if (!normalizedId) return listRegisteredAddons();
  extensions.lifecycle?.removeOwner?.(normalizedId);
  suspendedAddonIds.delete(normalizedId);
  addonLifecycle.requestTeardown(normalizedId, "unregister");
  addonLifecycle.emitLifecycleCommand(normalizedId, "before-unregister");
  return unregisterAddonFromRegistry(normalizedId);
}

export function cleanupAddonRuntimeResources(addonId, reason = "disable") {
  extensions.lifecycle?.removeOwner?.(addonId);
  const before = getAddonUiPolicySnapshot().owners;
  cleanupAddonObserverSubscriptions(addonId);
  cleanupAddonUi(addonId);
  const after = getAddonUiPolicySnapshot().owners;
  debugLog("addonsService", `Cleaned core-owned add-on resources (id=${addonId}, reason=${reason}).`, {
    data: { before, after },
  });
}

const suspendedAddonIds = new Set();

// Route reconciliation uses the original serialized add-on commands and cleanup.
export function reconcileAddonRoutes(resolveAddonAccessForAddon) {
  if (policy.legacyConfig) return;
  for (const addon of listRegisteredAddons()) {
    const access = resolveAddonAccessForAddon(suspendedAddonIds.has(addon.id) && getAddonState(addon.id).enabled !== false ? { ...addon, status: "installed" } : addon);
    if (access.isBlocked || !access.isEnabled || !access.supportsCurrentPage) {
      cleanupAddonRuntimeResources(addon.id, "route-or-policy-change");
      if (!suspendedAddonIds.has(addon.id)) {
        suspendedAddonIds.add(addon.id);
        addonLifecycle.emitLifecycleCommand(addon.id, "before-page-change");
        addonLifecycle.emitLifecycleCommand(addon.id, "disable");
      }
    } else if (suspendedAddonIds.delete(addon.id) && getAddonState(addon.id).enabled !== false) {
      updateAddonStatus(addon.id, "installed");
      addonLifecycle.cancelTeardown(addon.id);
      addonLifecycle.emitLifecycleCommand(addon.id, "enable");
    }
  }
}
