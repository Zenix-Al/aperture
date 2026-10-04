import { ADDONS_DEV_COMMAND_EVENT as CORE_EVENT, ADDON_COMMAND_EVENT, ADDONS_API_VERSION as CORE_PROTOCOL_VERSION, ADDONS_DEV_BRIDGE_MARKER as CORE_MARKER, ADDON_PROJECT_ID, ADDON_LEGACY_PROTOCOL } from "./contract.js";
const PING_TIMEOUT_MS = 1500;
const CORE_ACTION_TIMEOUT_MS = 2500;

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Shared handshake and API adapter for every core-connected add-on. */
export function createCoreBridge(addonId) {
  const normalizedAddonId = String(addonId || "").trim();

  let instanceId = "";
  let disposed = false;
  const pending = new Set();
  const bindings = new Set();
  function dispose() {
    disposed = true;
    for (const cancel of [...pending]) cancel();
    for (const unbind of [...bindings]) unbind();
  }

  function dispatchCoreCommand(type, payload = {}) {
    window.dispatchEvent(new CustomEvent(CORE_EVENT, { detail: { type, ...payload, ...(ADDON_LEGACY_PROTOCOL ? {} : { marker: CORE_MARKER, protocolVersion: CORE_PROTOCOL_VERSION, projectId: ADDON_PROJECT_ID, instanceId }) } }));
  }

  function waitForCorePing(timeoutMs = PING_TIMEOUT_MS) {
    if (disposed) return Promise.resolve({ ok: false, reason: "bridge_disposed" });
    return new Promise((resolve) => {
      const replyEvent = randomId(`aperture-${normalizedAddonId || "addon"}-ping`);
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        pending.delete(cancel);
        window.clearTimeout(timer);
        window.removeEventListener(replyEvent, onReply);
        resolve(result);
      };
      const onReply = (event) => {
        const detail = event?.detail || {};
        if (!ADDON_LEGACY_PROTOCOL && (detail.projectId !== ADDON_PROJECT_ID || detail.apiVersion !== CORE_PROTOCOL_VERSION || !detail.instanceId)) return;
        instanceId = String(detail.instanceId || "");
        finish({ ok: Boolean(detail.ok), apiVersion: String(detail.apiVersion || "") });
      };
      const timer = window.setTimeout(() => finish({ ok: false, apiVersion: "" }), timeoutMs);
      const cancel = () => finish({ ok: false, reason: "bridge_disposed" });
      pending.add(cancel);
      window.addEventListener(replyEvent, onReply);
      dispatchCoreCommand("ping", { replyEvent });
    });
  }

  function invokeCoreAction(action, payload = {}, timeoutMs = CORE_ACTION_TIMEOUT_MS) {
    if (disposed) return Promise.resolve({ ok: false, reason: "bridge_disposed" });
    return new Promise((resolve) => {
      const replyEvent = randomId(`aperture-${normalizedAddonId || "addon"}-core-action`);
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        pending.delete(cancel);
        window.clearTimeout(timer);
        window.removeEventListener(replyEvent, onReply);
        resolve(result);
      };
      const requestId = randomId(`aperture-${normalizedAddonId || "addon"}-request`);
      const onReply = (event) => {
        const detail = event?.detail;
        if (!ADDON_LEGACY_PROTOCOL && (!detail || detail.projectId !== ADDON_PROJECT_ID || detail.instanceId !== instanceId || detail.requestId !== requestId || detail.addonId !== normalizedAddonId || detail.protocolVersion !== CORE_PROTOCOL_VERSION)) return;
        finish(detail || { ok: false, reason: "empty_reply" });
      };
      const timer = window.setTimeout(() => finish({ ok: false, reason: "timeout" }), timeoutMs);
      const cancel = () => finish({ ok: false, reason: "bridge_disposed" });
      pending.add(cancel);
      window.addEventListener(replyEvent, onReply);
      dispatchCoreCommand("core-action", {
        marker: CORE_MARKER,
        protocolVersion: CORE_PROTOCOL_VERSION,
        requestId,
        addonId: normalizedAddonId,
        action,
        payload,
        replyEvent,
      });
    });
  }

  function bindAddonCommands(handler) {
    if (typeof handler !== "function") return () => {};
    const listener = (event) => {
      const detail = event?.detail || {};
      if (String(detail.addonId || "").trim() !== normalizedAddonId) return;
      if (!ADDON_LEGACY_PROTOCOL && (detail.projectId !== ADDON_PROJECT_ID || detail.instanceId !== instanceId)) return;
      handler(detail);
      if (detail.command === "teardown") dispose();
    };
    window.addEventListener(ADDON_COMMAND_EVENT, listener);
    const unbind = () => { window.removeEventListener(ADDON_COMMAND_EVENT, listener); bindings.delete(unbind); };
    bindings.add(unbind);
    return unbind;
  }

  function registerAddon(addon) {
    dispatchCoreCommand("register", { addon });
  }

  function updateStatus(status, statusMessage = "") {
    dispatchCoreCommand("update-status", { addonId: normalizedAddonId, status, statusMessage });
  }

  function teardownComplete(reason = "") {
    dispatchCoreCommand("teardown-complete", {
      addonId: normalizedAddonId,
      reason: String(reason || ""),
    });
  }

  return {
    bindAddonCommands,
    dispose,
    getPendingRequestCount: () => pending.size,
    dispatchCoreCommand,
    getAddonAccess: () => invokeCoreAction("addon.access", {}),
    getCoreThrottle: () => invokeCoreAction("addon.throttle", {}),
    invokeCoreAction,
    notifyTeardownComplete: teardownComplete,
    registerAddon,
    teardownComplete,
    updateStatus,
    waitForCorePing,
  };
}
