import { resourceManager } from "../../core/resourceManager.js";
import {
  getStorageReadinessSnapshot,
  subscribeStorageReadiness,
} from "../../services/storageReadiness.js";
import { createEl } from "../../utils/dom.js";

const CORE_SETTING_SELECTOR = ["input", "select", "textarea"].map(tag =>
  (__APERTURE_ADDONS__ ? ".settings-panel:not([data-addon-panel='true'])" : ".settings-panel") + " .config-row " + tag,
).join(",");

let boundRoot = null;
let unsubscribe = null;

export function syncStorageReadOnlyState(shadowRoot, snapshot = getStorageReadinessSnapshot()) {
  if (!shadowRoot) return;
  const readOnly = snapshot.state !== "ready";
  for (const control of shadowRoot.querySelectorAll(CORE_SETTING_SELECTOR)) {
    if (readOnly && !control.disabled) {
      control.disabled = true;
      control.dataset.storageDisabled = "1";
    } else if (!readOnly && control.dataset.storageDisabled) {
      control.disabled = false;
      delete control.dataset.storageDisabled;
    }
  }

  const container = shadowRoot.getElementById("global-settings-container");
  if (!container) return;
  let note = container.querySelector("[data-storage-readonly-note]");
  if (!note) {
    note = createEl("div", {
      className: "config-info",
      text: "Settings are read-only. Open Feature Health for storage diagnostics.",
    });
    note.dataset.storageReadonlyNote = "1";
    container.prepend(note);
  }
  note.hidden = !readOnly;
}

export function bindStorageReadOnlyState(shadowRoot) {
  if (!shadowRoot || boundRoot === shadowRoot) {
    syncStorageReadOnlyState(shadowRoot);
    return;
  }
  resourceManager.cleanup("ui:storage-readonly");
  unsubscribe?.();
  boundRoot = shadowRoot;
  unsubscribe = subscribeStorageReadiness((snapshot) => {
    if (!boundRoot?.host?.isConnected) {
      unsubscribe?.();
      unsubscribe = null;
      boundRoot = null;
      return;
    }
    syncStorageReadOnlyState(boundRoot, snapshot);
  });
  resourceManager.register("ui:storage-readonly", () => { unsubscribe?.(); unsubscribe = null; boundRoot = null; }, "ui:settings");
  syncStorageReadOnlyState(shadowRoot);
}
