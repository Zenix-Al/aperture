import { CONFIG_STORAGE_KEYS } from "../../config/persistence.js";
import { waitForStorageWriteAccess } from "../../services/storageReadiness.js";
import { stateManager } from "../../config/state.js";
import { storageAdapter } from "../../services/storageAdapter.js";

const DEFAULT_SETTINGS_PANEL = "settings-panel-general";

export const SETTINGS_ACTIVE_PANEL_STORAGE_KEY = CONFIG_STORAGE_KEYS.activePanel;
export const SETTINGS_PINNED_ADDONS_STORAGE_KEY = CONFIG_STORAGE_KEYS.pinnedAddons;

export function getDefaultSettingsPanelId() {
  return DEFAULT_SETTINGS_PANEL;
}

export async function persistSettingsUiValue(key, value) {
  if (![SETTINGS_ACTIVE_PANEL_STORAGE_KEY, SETTINGS_PINNED_ADDONS_STORAGE_KEY].includes(key)) return false;
  const access = await waitForStorageWriteAccess();
  if (!access.ok) return false;
  try {
    return (await storageAdapter.set(key, value)) !== false;
  } catch (error) {
    console.warn(`[settings-ui] Failed to persist ${key}:`, error);
  }
}

export async function ensureSettingsUiPrefsLoaded() {
  if (stateManager.get("settingsUiPrefsLoaded")) return;

  let activePanel = DEFAULT_SETTINGS_PANEL;
  let pinnedAddonIds = [];

  try {
    activePanel = String(
      await storageAdapter.get(SETTINGS_ACTIVE_PANEL_STORAGE_KEY, DEFAULT_SETTINGS_PANEL),
    );
  } catch {}

  try {
    const storedPins = await storageAdapter.get(SETTINGS_PINNED_ADDONS_STORAGE_KEY, []);
    if (Array.isArray(storedPins)) {
      pinnedAddonIds = storedPins.map((id) => String(id || "").trim()).filter(Boolean);
    }
  } catch {}

  stateManager.set("settingsActivePanel", activePanel || DEFAULT_SETTINGS_PANEL);
  stateManager.set("settingsPinnedAddonIds", [...new Set(pinnedAddonIds)]);
  stateManager.set("settingsUiPrefsLoaded", true);
}
