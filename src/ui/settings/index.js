import { getConfigPathMetadata } from "../../config/schema.js";
import { stateManager } from "../../config/state.js";
import policy from "aperture:ui-policy";
import { settingsTabs, mountSettingsTabComponents } from "./tabs.js";
import { contributeToSection } from "../settingsRuntime/sectionsRegistry.js";
import { resourceManager } from "../../core/resourceManager.js";
import { globalSettingsMeta } from "./globalSettings.js";
import { registerSettingsMetadata } from "./metaRegistry.js";
import { addonsServiceSettingsDialogMeta, addonsServiceSettingsMeta } from "../../services/addons/settingsUi.js";
let coreInitialized = false;
export function registerCoreSettings() {
  if (coreInitialized) return;
  const cleanups = [];
  try {
    cleanups.push(contributeToSection("global", globalSettingsMeta, "base:global"));
    cleanups.push(contributeToSection("global", addonsServiceSettingsMeta, "addons:service-settings"));
    cleanups.push(registerSettingsMetadata("global", addonsServiceSettingsDialogMeta, "addons:service-dialog"));
    resourceManager.register("ui:core-settings", () => { cleanups.forEach(cleanup => cleanup()); coreInitialized = false; }, "ui:settings");
    coreInitialized = true;
  } catch (error) { cleanups.forEach(cleanup => cleanup()); throw error; }
}
let initialized = false;
let initializing = null;

import { ensureSettingsUiPrefsLoaded } from "../settingsRuntime/prefs.js";
import {
  bindModalUiOnce,
  ensureModalSkeletonInjected,
  refreshModalAddonsUi,
  refreshModalDynamicSections,
} from "./modalLifecycle.js";

// Base (non-feature) settings.

export async function initModalUi() {
  registerCoreSettings();
  // Entry point for the settings modal. Responsibilities:
  // - Ensure the modal skeleton exists and event handlers are bound.
  // - Refresh dynamic sections (add-ons navigation/panels + settings sections).
  // - Initialize tags panel UI and load tags data once per session.
  if (!initialized) {
    if (!initializing) initializing = (async () => {
      await policy.initialize?.();
      const cleanups = [];
      try {
        for (const [section, map] of Object.entries(settingsTabs.settings)) {
          for (const meta of Object.values(map)) if (meta.config && !getConfigPathMetadata(meta.config)) throw new Error(`Undeclared UI setting: ${meta.config}`);
          cleanups.push(contributeToSection(section, map, "project-ui"));
        }
        resourceManager.register("ui:project-settings", () => { cleanups.forEach(cleanup => cleanup()); initialized = false; }, "ui:settings");
        initialized = true;
      } catch (error) { cleanups.forEach(cleanup => cleanup()); throw error; }
    })().finally(() => { initializing = null; });
    await initializing;
  }
  await ensureSettingsUiPrefsLoaded();

  policy.initAddonsRegistryBridge?.({
    onRegistryUpdate: (addons) => {
      policy.updateRegisteredAddons?.(addons, {
        refreshAddonsUi: () => {
          const sr = stateManager.get("shadowRoot");
          if (sr) refreshModalAddonsUi(sr);
        },
      });
    },
  });

  const shadowRoot = ensureModalSkeletonInjected();
  if (!shadowRoot) return;

  bindModalUiOnce(shadowRoot);
  refreshModalDynamicSections(shadowRoot);
  mountSettingsTabComponents(shadowRoot);
}
