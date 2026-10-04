import { stateManager } from "../../config/state.js";
import { addListener } from "../../core/listenerRegistry";
import { handleModalClick, handleOutsideSearchClick } from "../components/listeners";
import { injectModal } from "../components/modal";
import policy from "aperture:ui-policy";
import { renderAllSettingsSections } from "../settingsRuntime/sectionsRegistry.js";
import {
  initSettingsPanelNavigation,
  setActivePanel,
  syncActiveSettingsPanel,
} from "./panelNavigation.js";
import {
  bindStorageReadOnlyState,
  syncStorageReadOnlyState,
} from "./storageReadOnly.js";

export function ensureModalSkeletonInjected() {
  if (stateManager.get("modalInjected")) return stateManager.get("shadowRoot");

  injectModal();
  stateManager.set("modalInjected", true);
  return stateManager.get("shadowRoot");
}

export function refreshModalAddonsUi(shadowRoot) {
  policy.refreshAddonsUi?.(shadowRoot, {
    getRegisteredAddons: policy.getRegisteredAddons,
    getPinnedAddonIds: policy.getPinnedAddonIds,
    syncActiveSettingsPanel,
  });
}

export function bindModalUiOnce(shadowRoot) {
  const host = shadowRoot?.host;
  if (!shadowRoot || !host || host.dataset.settingsUiBound) return;

  initSettingsPanelNavigation(shadowRoot);
  policy.initAddinsPanelActions?.(shadowRoot, {
    setActivePanel: (panelId) => setActivePanel(shadowRoot, panelId),
    refreshAddonsUi: () => refreshModalAddonsUi(shadowRoot),
  });

  policy.initTagsPanelUi?.(shadowRoot);
  bindStorageReadOnlyState(shadowRoot);

  const modal = shadowRoot.getElementById("tag-config-modal");
  if (modal) {
    addListener("modal-delegated-click", modal, "click", handleModalClick, undefined, "ui:settings-modal");
  }

  addListener(
    "outside-search-click",
    document,
    "click",
    handleOutsideSearchClick,
    undefined,
    "ui:settings-modal",
  );
  host.dataset.settingsUiBound = "1";
}

export function refreshModalDynamicSections(shadowRoot) {
  if (!shadowRoot) return;
  policy.updateRegisteredAddons?.(null, { refreshAddonsUi: () => refreshModalAddonsUi(shadowRoot) });
  renderAllSettingsSections();
  syncStorageReadOnlyState(shadowRoot);
  policy.ensureTagsPanelDataLoaded?.();
}
