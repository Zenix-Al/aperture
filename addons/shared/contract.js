import project from "aperture:project";
import policy from "aperture:addons";

// One wire contract for the existing client and server implementations.
const prefix = `aperture:${project.id}:${project.storageNamespace}`;
export const ADDON_COMMAND_EVENT = policy.commandEvent || `${prefix}:addon-command`;
export const ADDONS_DEV_COMMAND_EVENT = policy.requestEvent || `${prefix}:addons-command`;
export const ADDONS_DEV_BRIDGE_MARKER = policy.marker || `${prefix}:bridge`;
export const ADDONS_API_VERSION = "0.1.0";

export const ADDON_PROJECT_ID = `${project.id}:${project.storageNamespace}`;
export const ADDON_LEGACY_PROTOCOL = policy.legacyConfig === true;
