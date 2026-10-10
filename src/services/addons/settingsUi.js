import {
  defaultAddonsApiThrottleSettings,
} from "../../config.js";
import { openConfirmDialog, openSettingsDialog } from "../../ui/components/dialog.js";
import { showToast } from "../../ui/components/toast.js";
import {
  createToggleSetting,
} from "../../ui/settings/metaFactory.js";
import { resourceManager } from "../../core/resourceManager.js";
import { updateConfig } from "../settingsService.js";
import {
  disableAddonsService,
  initAddonsConsoleBridge,
  refreshAddonSecurityPolicies,
} from "../addonsService.js";

const serviceAccessHeader = {
  type: "header",
  text: "Service Access",
};

const bridgeApiThrottleHeader = {
  type: "header",
  text: "Bridge API Throttle",
};

const disableAddonsServiceSetting = createToggleSetting({
  text: "Disable add-ons service",
  tooltip:
    "Disable the add-ons bridge/API entirely. Running add-ons on this page may keep running until you refresh.",
  config: "addons.service.disabled",
  beforeChange: async ({ previousValue, nextValue }) => {
    if (previousValue === true || nextValue !== true) {
      return true;
    }
    return openConfirmDialog({
      title: "Disable add-ons service?",
      description:
        "This disables the add-ons API/bridge. Add-ons already running on this page may need a refresh to fully stop.",
      confirmLabel: "Disable service",
      cancelLabel: "Cancel",
    });
  },
  custom: (value) => {
    if (value) {
      disableAddonsService();
      return;
    }
    return initAddonsConsoleBridge();
  },
  toast: (value) =>
    value
      ? "Add-ons service disabled. Refresh the page to fully unload running add-ons."
      : "Add-ons service enabled. Refresh the page to load add-ons.",
});

const allowUntrustedAddonsSetting = createToggleSetting({
  text: "Allow untrusted add-ons",
  tooltip: "Allow unknown add-ons to access the declared add-ons API. Enable only for scripts you trust.",
  config: "addons.service.allowUntrusted",
  beforeChange: async ({ previousValue, nextValue }) => {
    if (previousValue === true || nextValue !== true) return true;
    return openConfirmDialog({
      title: "Allow untrusted add-ons?",
      description: "This enables unknown scripts to access your add-ons API. Only continue if you fully trust the scripts you install.",
      confirmLabel: "I understand, enable", cancelLabel: "Cancel",
    });
  },
  custom: () => refreshAddonSecurityPolicies(),
  toast: value => value ? "Untrusted add-ons allowed with declared API access." : "Untrusted add-ons blocked unless trusted.",
});

const coreActionRateMaxSetting = {
  type: "number",
  text: "Core actions per window",
  tooltip:
    "Maximum add-on core API calls allowed per add-on within the window below. Higher values allow more requests during bulk work.",
  config: "addons.service.apiThrottle.coreActionRateMax",
  input: { min: 1, max: 1000, step: 1 },
  effects: {
    toast: (value) => `Core action rate limit set to ${value} requests per window`,
  },
};

const coreActionWindowMsSetting = {
  type: "number",
  text: "Core action window (ms)",
  tooltip:
    "Rolling time window used for the core action rate limit. Changes apply live to new add-on requests.",
  config: "addons.service.apiThrottle.coreActionWindowMs",
  input: { min: 250, max: 60000, step: 250 },
  effects: {
    toast: (value) => `Core action rate window set to ${value}ms`,
  },
};

const coreActionMaxConcurrentSetting = {
  type: "number",
  text: "Max concurrent core actions",
  tooltip:
    "Maximum simultaneous core API requests allowed per add-on before new requests are rejected as too many concurrent requests.",
  config: "addons.service.apiThrottle.coreActionMaxConcurrent",
  input: { min: 1, max: 100, step: 1 },
  effects: {
    toast: (value) => `Core action concurrency limit set to ${value}`,
  },
};

let resetThrottleConfirmUntil = 0;
let addonsServiceSettingsDialog = null;

async function resetAddonsApiThrottleDefaults() {
  const now = Date.now();
  if (now > resetThrottleConfirmUntil) {
    resetThrottleConfirmUntil = now + 3000;
    showToast("Press reset again within 3s to confirm.");
    return;
  }

  resetThrottleConfirmUntil = 0;
  const persisted = await updateConfig(draft => {
    draft.addons.service.apiThrottle = { ...defaultAddonsApiThrottleSettings };
  }, { origin: "addons:reset-throttle" });
  if (!persisted.committed) return;
  addonsServiceSettingsDialog?.close();
  addonsServiceSettingsDialog = null;
  showToast("Add-ons API throttle settings reset to default.");
}

const resetAddonsApiThrottleSetting = {
  type: "button",
  text: "Reset API throttle defaults",
  buttonText: "Reset",
  tooltip: "Reset add-ons core API rate limiting back to its default values.",
  effects: {
    custom: resetAddonsApiThrottleDefaults,
  },
};

export const addonsServiceSettingsDialogMeta = {
  _header_service_access: serviceAccessHeader,
  disableAddonsService: disableAddonsServiceSetting,
  allowUntrustedAddons: allowUntrustedAddonsSetting,
  _header_bridge_api_throttle: bridgeApiThrottleHeader,
  coreActionRateMax: coreActionRateMaxSetting,
  coreActionWindowMs: coreActionWindowMsSetting,
  coreActionMaxConcurrent: coreActionMaxConcurrentSetting,
  resetApiThrottle: resetAddonsApiThrottleSetting,
};

function openAddonsServiceSettingsDialog() {
  resourceManager.cleanup("ui:addons-service-settings");
  addonsServiceSettingsDialog = openSettingsDialog({
    title: "Add-ons Service Settings",
    description:
      "Configure add-on bridge access and the live core API throttle used by installed add-ons.",
    metaMap: addonsServiceSettingsDialogMeta,
  });
}

export const addonsServiceSettingsMeta = {
  addonsServiceSettings: {
    type: "button",
    text: "Add-ons service settings",
    buttonText: "Open",
    tooltip: "Configure add-ons bridge access and request throttling",
    effects: {
      custom: openAddonsServiceSettingsDialog,
    },
  },
};
