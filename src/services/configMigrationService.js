import settingsDefinition from "aperture:settings";
import { getDefaultConfig } from "../config/schema.js";
export const CONFIG_MIGRATION_VERSION = 1;
export const CONFIG_LEGACY_BRIDGE_VERSION = settingsDefinition.legacy?.CONFIG_LEGACY_BRIDGE_VERSION || "";
export const LEGACY_SURFACE_KEYS = Object.freeze(settingsDefinition.legacy?.LEGACY_SURFACE_KEYS || []);
export const LEGACY_EXTRA_KEYS = Object.freeze(settingsDefinition.legacy?.extraKeys || []);
function isRecord(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
export function hasRecognizedHistoricalData(values) { return settingsDefinition.legacy?.hasRecognizedHistoricalData?.(values) || false; }
export function classifyLegacyUpgrade(input = {}) {
  return settingsDefinition.legacy?.classifyLegacyUpgrade?.(input) || Object.freeze({ required: false, reason: "", bridgeVersion: "", sources: Object.freeze([]) });
}
export function getLegacyUpgradeMessage() { return settingsDefinition.legacy?.getLegacyUpgradeMessage?.() || "Stored configuration requires a supported migration."; }
export function getCanonicalData(configValue) {
  const source = isRecord(configValue) ? configValue : {};
  const defaults = getDefaultConfig();
  return JSON.parse(JSON.stringify({ ...source, ...Object.fromEntries(Object.keys(settingsDefinition.caches || {}).map(key => [key, defaults[key]])) }));
}

export function isCurrentMigrationMarker(value) {
  return value === CONFIG_MIGRATION_VERSION
    || (isRecord(value) && value.version === CONFIG_MIGRATION_VERSION && value.completed === true);
}
