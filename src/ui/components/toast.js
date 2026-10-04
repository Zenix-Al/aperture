import project from "aperture:project";
import ui from "aperture:ui";
const fallbackId = ui.legacy ? "toast-container" : `${project.id}-${project.storageNamespace}-toast-container`;
import { markThemedRoot } from "../theme.js";
import { resourceManager } from "../../core/resourceManager.js";
let toastSequence = 0;
import { stateManager } from "../../config/state.js";
import { configureCoreContext } from "../../core/coreContext.js";
import { TIMINGS } from "../../config/timings.js";
import { createEl } from "../../utils/dom.js";

const MAX_TOASTS = 4;
const TOAST_DURATION = TIMINGS.TOAST_DISPLAY;
const pendingToasts = [];

// Optional UI provider; health reporting works when this UI is never imported.
configureCoreContext({ notify: showToast });

function ensureFallbackToastContainer() {
  if (typeof document === "undefined") return null;
  if (!document.body) return null;

  let container = document.getElementById(fallbackId);
  if (container) return container;

  container = createEl("div", { attrs: { id: fallbackId } });
  container.classList.add("aperture-toast-container");
  markThemedRoot(container);
  document.body.appendChild(container);
  resourceManager.register("ui:toast-fallback", () => container.remove(), "ui:toasts");
  return container;
}

function resolveToastContainer() {
  const shadowRoot = stateManager.get("shadowRoot");

  if (shadowRoot?.getElementById) {
    let container = shadowRoot.getElementById("toast-container");
    if (!container) {
      container = createEl("div", { attrs: { id: "toast-container" } });
      shadowRoot.appendChild(container);
    }
    return container;
  }

  return ensureFallbackToastContainer();
}

function renderToast({ message, duration = TOAST_DURATION, type = "info" }) {
  const container = resolveToastContainer();
  if (!container) return false;

  const colors = {
    success: "var(--aperture-success-surface, #4CAF50)",
    error: "var(--aperture-error-surface, #F44336)",
    warning: "var(--aperture-warning-surface, #FF9800)",
    info: "",
  };
  const toast = createEl("div", {
    className: "toast",
    text: message,
    style: { backgroundColor: colors[type] || "" },
  });
  container.appendChild(toast);

  // enforce limit
  while (container.children.length > MAX_TOASTS) {
    container.firstElementChild.remove();
  }

  const resourceId = `ui:toast:${++toastSequence}`;
  let removeTimer;
  const frame = requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  const timer = setTimeout(() => {
    toast.classList.remove("show");
    removeTimer = setTimeout(() => resourceManager.cleanup(resourceId), 200);
  }, duration);
  resourceManager.register(resourceId, () => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    clearTimeout(timer); clearTimeout(removeTimer); toast.remove();
  }, "ui:toasts");

  return true;
}

function normalizeToastRequest(message, duration = TOAST_DURATION, type = "info") {
  return {
    message: String(message || ""),
    duration: Number.isFinite(Number(duration)) ? Number(duration) : TOAST_DURATION,
    type: String(type || "info").trim() || "info",
  };
}

export function showToast(message, duration = TOAST_DURATION, type = "info") {
  const request = normalizeToastRequest(message, duration, type);
  if ((typeof document === "undefined" || !document.body) && !stateManager.get("shadowRoot")) {
    pendingToasts.push(request);
    return;
  }

  if (!renderToast(request)) {
    pendingToasts.push(request);
  }
}

export function flushQueuedToasts() {
  if (pendingToasts.length === 0) return 0;

  const queued = pendingToasts.splice(0, pendingToasts.length);
  let flushed = 0;

  for (let index = 0; index < queued.length; index += 1) {
    const request = queued[index];
    if (renderToast(request)) {
      flushed += 1;
      continue;
    }

    pendingToasts.unshift(...queued.slice(index));
    break;
  }

  return flushed;
}
