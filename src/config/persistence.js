import project from "aperture:project";
import settingsDefinition from "aperture:settings";

const prefix = `aperture:${project.id}:${project.storageNamespace}:`;
export const CONFIG_STORAGE_KEYS = Object.freeze(project.storageKeys || Object.fromEntries(Object.entries({
  current: "config", backup: "config:last-known-good", recovery: "config:recovery",
  migrationVersion: "config:migration-version", migrationLock: "config:migration-lock",
  initializationLock: "config:initialization-lock", tagsCache: "cache:tags", prefixesCache: "cache:prefixes",
  probe: "storage:probe:", activePanel: "ui:active-panel", pinnedAddons: "ui:pinned-addons",
  catalogCache: "addons:trusted-catalog-cache", addonDatabasePrefix: "addon:db",
}).map(([key, suffix]) => [key, prefix + suffix])));
export function getCacheStorageKey(section) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(section)) throw new TypeError("Invalid cache section");
  return CONFIG_STORAGE_KEYS[`${section}Cache`] || `${prefix}cache:${section}`;
}
export function getAddonStorageKey(addonId, key) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(addonId) || typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) throw new TypeError("Invalid add-on storage key");
  return `${project.storageKeys?.addonPrefix || `${prefix}addon:`}${addonId}:${key}`;
}
export function getAddonDatabaseName(addonId, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new TypeError("Invalid database name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(addonId)) throw new TypeError("Invalid add-on id");
  return `${CONFIG_STORAGE_KEYS.addonDatabasePrefix}:${addonId}:${name}`;
}
export const CONFIG_SCHEMA_VERSION = settingsDefinition.schemaVersion ?? 1;
export const CONFIG_MIGRATIONS = Object.freeze((settingsDefinition.migrations || []).map(step => Object.freeze({ ...step })));
if (!Number.isInteger(CONFIG_SCHEMA_VERSION) || CONFIG_SCHEMA_VERSION < 1 || CONFIG_MIGRATIONS.length !== CONFIG_SCHEMA_VERSION - 1) throw new TypeError("Invalid config migration registry");
for (let index = 0; index < CONFIG_MIGRATIONS.length; index++) {
  const step = CONFIG_MIGRATIONS[index];
  if (step.fromVersion !== index + 1 || step.toVersion !== index + 2 || typeof step.migrate !== "function") throw new TypeError("Invalid config migration registry");
}
export const CONFIG_MIGRATION_COUNT = CONFIG_MIGRATIONS.length;

export function isCurrentConfigVersion(version) {
  return Number.isInteger(version) && version === CONFIG_SCHEMA_VERSION;
}

export function isSupportedConfigVersion(version) {
  return Number.isInteger(version) && version >= 1 && version <= CONFIG_SCHEMA_VERSION;
}

export function migrateConfigSchema(data, fromVersion, toVersion = CONFIG_SCHEMA_VERSION) {
  let current = Number(fromVersion);
  let migrated = JSON.parse(JSON.stringify(data));
  while (current < toVersion) {
    const step = CONFIG_MIGRATIONS.find((entry) => entry.fromVersion === current);
    if (!step || step.toVersion <= current) throw new Error("unsupported_config_schema");
    migrated = step.migrate(migrated);
    current = step.toVersion;
  }
  if (current !== toVersion) throw new Error("unsupported_config_schema");
  return migrated;
}
