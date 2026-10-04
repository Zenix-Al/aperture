import { registerCoreSettings } from "./settings/index.js";
import { injectButton } from "./components/configButton";
import { updateButtonVisibility } from "./components/configButton";
import { injectCSS } from "./helpers/cssInjector";
import policy from "aperture:ui-policy";
import ui from "aperture:ui";
import project from "aperture:project";
import { markThemedRoot } from "./theme.js";
import { resourceManager } from "../core/resourceManager.js";
import { stateManager } from "../config/state.js";
import { createEl } from "../utils/dom.js";

function initShadowDOM() {
  const existing = stateManager.get("shadowRoot");
  if (existing) { markThemedRoot(existing.host); return; } // Reacquire after style cleanup.
  const shadowHost = createEl("div", { attrs: { id: ui.hostId || `${project.id}-${project.storageNamespace}-ui` }, mount: document.body });

  markThemedRoot(shadowHost);
  stateManager.set("shadowRoot", shadowHost.attachShadow({ mode: "open" }));
  resourceManager.register("ui:shadow-host", () => { shadowHost.remove(); stateManager.set("shadowRoot", null); stateManager.set("modalInjected", false); }, "ui:root");
}

export function initUiPhaseIfApplicable() {
  if (ui.applicable && !ui.applicable(stateManager)) return false;

  registerCoreSettings();
  initShadowDOM();
  injectCSS();
  injectButton();
  policy.updateColorStyle?.();
  updateButtonVisibility();
  return true;
}
