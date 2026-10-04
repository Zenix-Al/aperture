import { resourceManager } from "./resourceManager.js";

let bridgeResourceSequence = 0;

export function ensurePageBridge({ marker, scriptContent }) {
  if (typeof document === "undefined") return false;
  if (!document?.documentElement) return false;
  if (document.documentElement.dataset[marker] === "1") return true;

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.textContent = scriptContent;

  try {
    document.documentElement.appendChild(script);
    script.remove();
    document.documentElement.dataset[marker] = "1";
    return true;
  } catch {
    try {
      script.remove();
    } catch {
      // ignore remove failure
    }
    return false;
  }
}

export function requestPageBridge({ requestEvent, resultEvent, detail = null, timeoutMs = 1500, signal = null, ownerId = null }) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const resourceId = ownerId ? `page-bridge:request:${++bridgeResourceSequence}` : null;
    let resourceRegistered = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener(resultEvent, onResult);
      signal?.removeEventListener("abort", onAbort);
      if (resourceRegistered) resourceManager.unregister(resourceId);
      resolve(result);
    };

    const onResult = (event) => {
      finish({
        received: true,
        reason: "",
        detail: event?.detail || {},
      });
    };

    const onAbort = () => finish({ received: false, reason: "bridge_aborted", detail: {} });
    if (signal?.aborted) { onAbort(); return; }

    timer = setTimeout(() => {
      finish({
        received: false,
        reason: "bridge_timeout",
        detail: {},
      });
    }, timeoutMs);

    window.addEventListener(resultEvent, onResult);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (resourceId) {
      try {
        resourceManager.register(resourceId, onAbort, ownerId);
        resourceRegistered = true;
      } catch (error) {
        clearTimeout(timer);
        window.removeEventListener(resultEvent, onResult);
        signal?.removeEventListener("abort", onAbort);
        throw error;
      }
    }

    try {
      window.dispatchEvent(new CustomEvent(requestEvent, { detail }));
    } catch (error) {
      finish({
        received: false,
        reason: error?.message ? String(error.message) : "bridge_dispatch_failed",
        detail: {},
      });
    }
  });
}

export function dispatchPageBridgeEvent(eventName, detail = null) {
  if (typeof window === "undefined" || !eventName) return false;
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
    return true;
  } catch {
    return false;
  }
}

export function subscribePageBridgeEvent(eventName, callback, { ownerId = null } = {}) {
  if (typeof window === "undefined" || !eventName || typeof callback !== "function") {
    return () => {};
  }
  const resourceId = ownerId ? `page-bridge:subscription:${++bridgeResourceSequence}` : null;
  let resourceRegistered = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener(eventName, callback);
    if (resourceRegistered) resourceManager.unregister(resourceId);
  };
  window.addEventListener(eventName, callback);
  if (resourceId) {
    try {
      resourceManager.register(resourceId, dispose, ownerId);
      resourceRegistered = true;
    } catch (error) {
      window.removeEventListener(eventName, callback);
      throw error;
    }
  }
  return dispose;
}
