import project from "aperture:project";
import definition from "aperture:application";
import { createStateManager } from "../core/StateManager.js";
import { configureCoreContext } from "../core/coreContext.js";
import { getDefaultConfig } from "./schema.js";

export let config = getDefaultConfig();
export const pageDefinitions = Object.freeze({ ...project.routes, ...definition.routes });
export const stateManager = definition.stateManager || createStateManager({
  modalInjected: false,
  settingsUiPrefsLoaded: false,
  settingsActivePanel: "settings-panel-general",
  ...(__APERTURE_ADDONS__ ? { settingsPinnedAddonIds: [] } : {}),
  ...definition.state,
  shadowRoot: definition.state?.shadowRoot ?? null,
  ...Object.fromEntries(Object.keys(pageDefinitions).map(key => [key, false])),
}, { warnUnknown: true, name: "RuntimeState" });
configureCoreContext({ id: project.id, getConfig: definition.getConfig || (() => config), stateManager, pageDefinitions });
