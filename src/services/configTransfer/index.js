import { config } from "../../config/state.js";
import project from "aperture:project";
import settingsDefinition from "aperture:settings";
import {
  getConfigPathMetadata,
  CONFIG_SCHEMA,
  getExportableConfigKeys,
  validateConfig,
} from "../../config/schema.js";
import { CONFIG_SCHEMA_VERSION } from "../../config/persistence.js";
import { updateConfig } from "../settingsService.js";

export const CONFIG_TRANSFER_FORMAT_VERSION = 1;

const DOCUMENT_METADATA_KEYS = Object.freeze([
  "formatVersion",
  "schemaVersion",
  "applicationVersion",
  "exportedAt",
  ...(settingsDefinition.transfer?.requireIdentity === false ? [] : ["projectId", "storageNamespace"]),
]);
const LEGACY_IMPORT_KEYS = Object.freeze(settingsDefinition.transfer?.legacyKeys || []);

const requireIdentity = settingsDefinition.transfer?.requireIdentity !== false;
function transferable(descriptor, inherited = false) {
  if (!descriptor || descriptor.sensitive) return false;
  const enabled = descriptor.exportable ?? inherited;
  if (descriptor.type === "array") {
    const protectedChild = (node) => node && (node.sensitive || node.exportable === false || Object.values(node.properties || {}).some(protectedChild) || protectedChild(node.items) || (typeof node.additionalProperties === "object" && protectedChild(node.additionalProperties)));
    return enabled && !protectedChild(descriptor.items);
  }
  return enabled;
}
function filterTransfer(value, descriptor, inherited = false, path = "", issues = null) {
  if (!transferable(descriptor, inherited)) {
    if (issues) issues.push(issue(path, "not_exportable", "non-sensitive exportable setting", value));
    return undefined;
  }
  if (isPlainObject(value) && descriptor.type === "object") {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const childDescriptor = descriptor.properties?.[key] || (typeof descriptor.additionalProperties === "object" ? descriptor.additionalProperties : null);
      const filtered = filterTransfer(child, childDescriptor, descriptor.exportable ?? inherited, `${path}.${key}`, issues);
      if (filtered !== undefined) result[key] = filtered;
    }
    return result;
  }
  return clone(value);
}

function issue(path, code, expected, value) {
  return {
    path: String(path || ""),
    code,
    expected,
    receivedType: Array.isArray(value) ? "array" : value === null ? "null" : typeof value,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applicationVersion() {
  const version = globalThis.GM_info?.script?.version;
  return typeof version === "string" && version.trim() ? version.trim() : "unknown";
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function diffPaths(before, after, prefix = "") {
  if (Object.is(before, after)) return [];
  const beforeObject = before && typeof before === "object";
  const afterObject = after && typeof after === "object";
  if (!beforeObject || !afterObject || Array.isArray(before) !== Array.isArray(after)) return [prefix];

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => diffPaths(
    before[key],
    after[key],
    prefix ? `${prefix}.${key}` : key,
  ));
}

function mergePartial(previous, next) {
  if (!isPlainObject(previous) || !isPlainObject(next)) return clone(next);
  const merged = clone(previous);
  for (const [key, value] of Object.entries(next)) {
    merged[key] = isPlainObject(merged[key]) && isPlainObject(value)
      ? mergePartial(merged[key], value)
      : clone(value);
  }
  return merged;
}

function normalizeImportSettings(settings) { return settingsDefinition.transfer?.normalizeCurrent?.(settings) ?? clone(settings); }
function normalizeLegacyTransferSettings(settings) { return settingsDefinition.transfer?.normalizeLegacy?.(settings) ?? clone(settings); }

function parseDocument(input) {
  if (typeof input !== "string") return { value: input, issues: [] };
  try {
    return { value: JSON.parse(input), issues: [] };
  } catch {
    return { value: null, issues: [issue("", "invalid_json", "valid JSON object", input)] };
  }
}

function readDocument(input) {
  const parsed = parseDocument(input);
  if (parsed.issues.length > 0) return { ok: false, issues: parsed.issues, warnings: [] };
  if (!isPlainObject(parsed.value)) {
    return { ok: false, issues: [issue("", "type", "JSON object", parsed.value)], warnings: [] };
  }

  const source = parsed.value;
  const hasSettingsRoot = Object.hasOwn(source, "settings");
  const metadata = {};
  const issues = [];
  if (requireIdentity) {
    for (const [key, expected] of Object.entries({ projectId: project.id, storageNamespace: project.storageNamespace, formatVersion: CONFIG_TRANSFER_FORMAT_VERSION, schemaVersion: CONFIG_SCHEMA_VERSION })) {
      if (source[key] !== expected) issues.push(issue(key, "incompatible", "matching project identity and current version", source[key]));
    }
  }
  for (const key of DOCUMENT_METADATA_KEYS) {
    if (Object.hasOwn(source, key)) metadata[key] = source[key];
  }

  const allowedRootKeys = new Set(hasSettingsRoot
    ? ["settings", ...DOCUMENT_METADATA_KEYS]
    : [...DOCUMENT_METADATA_KEYS, ...getExportableConfigKeys(), ...LEGACY_IMPORT_KEYS]);
  for (const key of Object.keys(source)) {
    if (!allowedRootKeys.has(key)) issues.push(issue(key, "unsupported", "supported transfer field", source[key]));
  }

  const formatVersion = Object.hasOwn(metadata, "formatVersion") ? metadata.formatVersion : 0;
  if (!Number.isInteger(formatVersion) || formatVersion < 0) {
    issues.push(issue("formatVersion", "version", `integer between 0 and ${CONFIG_TRANSFER_FORMAT_VERSION}`, formatVersion));
  } else if (formatVersion > CONFIG_TRANSFER_FORMAT_VERSION) {
    issues.push(issue("formatVersion", "unsupported", `version <= ${CONFIG_TRANSFER_FORMAT_VERSION}`, formatVersion));
  }
  if (formatVersion >= CONFIG_TRANSFER_FORMAT_VERSION && Object.hasOwn(source, "minVersion")) {
    issues.push(issue("minVersion", "unsupported", "supported transfer field", source.minVersion));
  }

  const schemaVersion = Object.hasOwn(metadata, "schemaVersion") ? metadata.schemaVersion : 0;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
    issues.push(issue("schemaVersion", "version", `integer between 0 and ${CONFIG_SCHEMA_VERSION}`, schemaVersion));
  } else if (schemaVersion > CONFIG_SCHEMA_VERSION) {
    issues.push(issue("schemaVersion", "unsupported", `version <= ${CONFIG_SCHEMA_VERSION}`, schemaVersion));
  }

  if (Object.hasOwn(metadata, "exportedAt") && typeof metadata.exportedAt !== "string") {
    issues.push(issue("exportedAt", "type", "ISO date string", metadata.exportedAt));
  }
  if (Object.hasOwn(metadata, "exportedAt") && typeof metadata.exportedAt === "string" && Number.isNaN(Date.parse(metadata.exportedAt))) {
    issues.push(issue("exportedAt", "format", "ISO date string", metadata.exportedAt));
  }
  if (Object.hasOwn(metadata, "applicationVersion") && typeof metadata.applicationVersion !== "string") {
    issues.push(issue("applicationVersion", "type", "version string", metadata.applicationVersion));
  }

  const settings = hasSettingsRoot ? source.settings : Object.fromEntries(
    getExportableConfigKeys()
      .filter((key) => Object.hasOwn(source, key))
      .map((key) => [key, source[key]]),
  );
  if (!hasSettingsRoot && formatVersion === 0 && Object.hasOwn(source, "minVersion")) settings.minVersion = source.minVersion;
  if (!isPlainObject(settings)) issues.push(issue("settings", "type", "object", settings));

  const exportable = new Set(getExportableConfigKeys());
  if (isPlainObject(settings)) {
    for (const key of Object.keys(settings)) {
      if (requireIdentity) filterTransfer(settings[key], CONFIG_SCHEMA[key], false, `settings.${key}`, issues);
      if (!exportable.has(key) && !(formatVersion === 0 && LEGACY_IMPORT_KEYS.includes(key))) {
        issues.push(issue(`settings.${key}`, "not_exportable", "schema-exportable setting", settings[key]));
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings: [],
    formatVersion,
    schemaVersion,
    settings: normalizeImportSettings(settings),
    migrated: formatVersion < CONFIG_TRANSFER_FORMAT_VERSION || schemaVersion < CONFIG_SCHEMA_VERSION,
  };
}

function suppliedValues(normalized, supplied) {
  if (!isPlainObject(normalized) || !isPlainObject(supplied)) return normalized;
  return Object.fromEntries(Object.keys(supplied).map(key => [key, suppliedValues(normalized[key], supplied[key])]));
}

function buildCandidate(settings) {
  const candidate = clone(config);
  for (const [key, value] of Object.entries(settings)) {
    candidate[key] = mergePartial(candidate[key], value);
  }
  return candidate;
}

function reloadRequired(changedPaths) {
  return changedPaths.some((path) => getConfigPathMetadata(path)?.reloadRequired);
}

export function buildConfigExport({ exportedAt = new Date() } = {}) {
  const settings = Object.fromEntries(getExportableConfigKeys().map((key) => [key, requireIdentity ? filterTransfer(config[key], CONFIG_SCHEMA[key]) : clone(config[key])]).filter(([, value]) => value !== undefined));
  return {
    ...(requireIdentity ? { projectId: project.id, storageNamespace: project.storageNamespace } : {}),
    formatVersion: CONFIG_TRANSFER_FORMAT_VERSION,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    applicationVersion: applicationVersion(),
    exportedAt: new Date(exportedAt).toISOString(),
    settings,
  };
}

export function previewConfigImport(input) {
  const document = readDocument(input);
  if (!document.ok) return { ok: false, issues: document.issues, warnings: document.warnings };
  if (Object.keys(document.settings).length === 0) {
    return { ok: false, issues: [issue("settings", "empty", "at least one exportable setting", document.settings)], warnings: document.warnings };
  }

  let settings = document.settings;
  const warnings = [...document.warnings];
  if (document.schemaVersion < CONFIG_SCHEMA_VERSION || document.formatVersion < CONFIG_TRANSFER_FORMAT_VERSION) {
    const legacyValidationInput = normalizeLegacyTransferSettings(settings);
    if (isPlainObject(legacyValidationInput)) {
      for (const key of LEGACY_IMPORT_KEYS) delete legacyValidationInput[key];
    }
    const legacyValidation = validateConfig(legacyValidationInput, { mode: "strict", partial: true });
    if (!legacyValidation.valid) return { ok: false, issues: legacyValidation.issues, warnings };
    try {
      settings = normalizeLegacyTransferSettings(settings);
      warnings.push({ code: "migrated", message: "A supported legacy configuration format was normalized." });
    } catch {
      return { ok: false, issues: [issue("schemaVersion", "migration_failed", "supported configuration format", document.schemaVersion)], warnings };
    }
  }

  const validation = validateConfig(settings, { mode: "strict", partial: true });
  if (!validation.valid) return { ok: false, issues: validation.issues, warnings };
  const candidate = buildCandidate(requireIdentity ? suppliedValues(validation.data, settings) : validation.data);
  const completeValidation = validateConfig(candidate, { mode: "strict" });
  if (!completeValidation.valid) return { ok: false, issues: completeValidation.issues, warnings };

  const changedPaths = [...new Set(diffPaths(config, completeValidation.data).filter(Boolean))].sort();
  return {
    ok: true,
    candidate: completeValidation.data,
    changedPaths,
    changedSections: [...new Set(changedPaths.map((path) => path.match(/^[^.[\]]+/)?.[0] || path))],
    warnings,
    formatVersion: document.formatVersion,
    schemaVersion: document.schemaVersion,
    migrated: document.migrated,
    reloadRequired: reloadRequired(changedPaths),
  };
}

export async function commitConfigImport(input) {
  const preview = previewConfigImport(input);
  if (!preview.ok) return preview;
  const result = await updateConfig((draft) => {
    for (const section of preview.changedSections || []) {
      draft[section] = clone(preview.candidate[section]);
    }
  }, { origin: "import", persistRuntimeCatalogs: settingsDefinition.transfer?.persistCaches || Object.keys(settingsDefinition.caches || {}) });
  if (!result.committed) return { ...preview, ...result, ok: false };
  return {
    ...preview,
    ...result,
    ok: true,
    reloadRequired: reloadRequired(result.changedPaths || preview.changedPaths),
  };
}
