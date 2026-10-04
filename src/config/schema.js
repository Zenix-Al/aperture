import settingsDefinition from "aperture:settings";
import { addonConfigSchema } from "./addonSchema.js";

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function node(type, defaultValue, options = {}) {
  return { type, defaultValue, ...options };
}

const anyValue = node("any", {});
const projectSchema = settingsDefinition.schema || {};
if (Object.hasOwn(projectSchema, "globalSettings")) throw new TypeError("globalSettings is owned by core");
if (projectSchema.addons && projectSchema.addons !== addonConfigSchema) throw new TypeError("addons is owned by core");
const CONFIG_SCHEMA = {
  globalSettings: node("object", { configVisibility: true }, {
    exportable: true, additionalProperties: false,
    properties: { configVisibility: node("boolean", true) },
  }),
  addons: addonConfigSchema,
  ...projectSchema,
};

function validateDescriptors(properties, ancestors = new Set()) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) throw new TypeError("Settings schema requires an object");
  for (const [key, descriptor] of Object.entries(properties)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new TypeError("Invalid schema path");
    if (!descriptor || typeof descriptor !== "object" || !["any", "boolean", "number", "string", "array", "object"].includes(descriptor.type) || !Object.hasOwn(descriptor, "defaultValue") || ancestors.has(descriptor)) throw new TypeError("Invalid schema descriptor");
    for (const flag of ["exportable", "sensitive", "reloadRequired", "persisted"]) {
      if (descriptor[flag] !== undefined && typeof descriptor[flag] !== "boolean") throw new TypeError("Invalid schema metadata");
    }
    const next = new Set([...ancestors, descriptor]);
    if (descriptor.properties) validateDescriptors(descriptor.properties, next);
    if (descriptor.items) validateDescriptors({ item: descriptor.items }, next);
    if (typeof descriptor.additionalProperties === "object") validateDescriptors({ value: descriptor.additionalProperties }, next);
  }
}
validateDescriptors(CONFIG_SCHEMA);

const METADATA_INDEX = new Map();

function buildIndexes() {
  const walk = (descriptor, path, inherited = {}) => {
    const metadata = Object.freeze({
      persisted: true,
      exportable: Boolean(inherited.exportable || descriptor.exportable),
      sensitive: Boolean(inherited.sensitive || descriptor.sensitive),
      reloadRequired: Boolean(inherited.reloadRequired || descriptor.reloadRequired),
    });
    METADATA_INDEX.set(path, metadata);
    if (descriptor.properties) {
      for (const [key, child] of Object.entries(descriptor.properties)) walk(child, `${path}.${key}`, metadata);
    }
    if (descriptor.additionalProperties && descriptor.additionalProperties !== false && typeof descriptor.additionalProperties === "object") {
      walk(descriptor.additionalProperties, `${path}.*`, metadata);
    }
    if (descriptor.items) walk(descriptor.items, `${path}[]`, metadata);
  };
  for (const [key, descriptor] of Object.entries(CONFIG_SCHEMA)) walk(descriptor, key);
}

deepFreeze(CONFIG_SCHEMA);
buildIndexes();
const ROOT_DEFAULT_CONFIG = Object.freeze(Object.fromEntries(
  Object.entries(CONFIG_SCHEMA).map(([key, descriptor]) => [key, descriptor.defaultValue]),
));
export { CONFIG_SCHEMA };

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function issue(path, code, expected, value) {
  const receivedType = typeOf(value);
  return {
    path,
    code,
    expected,
    received: receivedType,
    receivedType,
    receivedSummary: receivedType,
  };
}

function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function validateNode(value, descriptor, path, context) {
  if (value === undefined) {
    if (descriptor.required) context.issues.push(issue(path, "required", descriptor.type, value));
    return clone(descriptor.defaultValue);
  }
  if (value === null && descriptor.nullable) return null;
  if (descriptor.type === "any") return clone(value);

  if (descriptor.type === "array" && !Array.isArray(value)) {
    context.issues.push(issue(path, "type", "array", value));
    return clone(descriptor.defaultValue);
  }
  if (descriptor.type === "object" && !isObject(value)) {
    context.issues.push(issue(path, "type", "object", value));
    return clone(descriptor.defaultValue);
  }
  if (descriptor.type !== "array" && descriptor.type !== "object" && typeof value !== descriptor.type) {
    context.issues.push(issue(path, "type", descriptor.type, value));
    return clone(descriptor.defaultValue);
  }

  const validationStart = context.issues.length;
  if (descriptor.type === "string") {
    if (descriptor.minLength !== undefined && value.length < descriptor.minLength) context.issues.push(issue(path, "length", `string length >= ${descriptor.minLength}`, value));
    if (descriptor.maxLength !== undefined && value.length > descriptor.maxLength) context.issues.push(issue(path, "length", `string length <= ${descriptor.maxLength}`, value));
    if (descriptor.pattern && !descriptor.pattern.test(value)) context.issues.push(issue(path, "pattern", "matching string pattern", value));
    if (descriptor.enum && !descriptor.enum.includes(value)) context.issues.push(issue(path, "enum", descriptor.enum.join(" | "), value));
  }
  if (descriptor.type === "number") {
    if (!Number.isFinite(value)) context.issues.push(issue(path, "finite", "finite number", value));
    if (descriptor.integer && !Number.isInteger(value)) context.issues.push(issue(path, "integer", "integer", value));
    if (descriptor.min !== null && descriptor.min !== undefined && value < descriptor.min) context.issues.push(issue(path, "range", `number >= ${descriptor.min}`, value));
    if (descriptor.max !== null && descriptor.max !== undefined && value > descriptor.max) context.issues.push(issue(path, "range", `number <= ${descriptor.max}`, value));
  }

  if (descriptor.type === "array") {
    const result = [];
    for (let index = 0; index < value.length; index++) {
      const itemStart = context.issues.length;
      const normalizedItem = validateNode(value[index], descriptor.items || anyValue, `${path}[${index}]`, context);
      if (context.mode !== "strict" && context.issues.length > itemStart) continue;
      result.push(normalizedItem);
    }
    if (descriptor.unique || descriptor.uniqueBy) {
      const seen = new Set();
      const deduped = [];
      for (let index = 0; index < result.length; index++) {
        const key = descriptor.uniqueBy ? result[index]?.[descriptor.uniqueBy] : result[index];
        if (seen.has(key)) {
          context.issues.push(issue(`${path}[${index}]`, "unique", "unique array item", result[index]));
          if (context.mode !== "strict") continue;
        }
        seen.add(key);
        deduped.push(result[index]);
      }
      if (context.mode !== "strict") result.splice(0, result.length, ...deduped);
    }
    if (descriptor.exactLength !== undefined && result.length !== descriptor.exactLength) context.issues.push(issue(path, "length", `array length ${descriptor.exactLength}`, result));
    if (descriptor.validate) {
      const resultIssue = descriptor.validate(result);
      if (resultIssue) context.issues.push(issue(path, resultIssue.code, resultIssue.expected, result));
    }
    if (context.mode !== "strict" && context.issues.length > validationStart && descriptor.exactLength !== undefined && result.length !== descriptor.exactLength) {
      return clone(descriptor.defaultValue);
    }
    return result;
  }

    if (descriptor.type === "object") {
    const result = {};
    const properties = descriptor.properties || {};
    for (const key of Object.keys(value)) {
      if (["__proto__", "constructor", "prototype"].includes(key)) { context.issues.push(issue(`${path}.${key}`, "key", "safe object key", key)); continue; }
      if (descriptor.keyPattern && !descriptor.keyPattern.test(key)) context.issues.push(issue(`${path}.${key}`, "key", "matching object key pattern", key));
      if (Object.hasOwn(properties, key)) continue;
      if (descriptor.additionalProperties && descriptor.additionalProperties !== false) continue;
      context.issues.push(issue(`${path ? `${path}.` : ""}${key}`, "unknown", "known key", value[key]));
    }
    for (const [key, child] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) result[key] = validateNode(value[key], child, `${path}.${key}`, context);
      else result[key] = clone(child.defaultValue);
    }
    if (descriptor.additionalProperties && descriptor.additionalProperties !== false && typeof descriptor.additionalProperties === "object") {
      for (const key of Object.keys(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key) || Object.hasOwn(properties, key)) continue;
        if (descriptor.keyPattern && !descriptor.keyPattern.test(key)) {
          if (context.mode !== "strict") continue;
        }
        result[key] = descriptor.additionalProperties === true
          ? clone(value[key])
          : validateNode(value[key], descriptor.additionalProperties, `${path}.${key}`, context);
      }
    }
    if (descriptor.validate) {
      const resultIssue = descriptor.validate(result);
      if (resultIssue) context.issues.push(issue(path, resultIssue.code, resultIssue.expected, result));
    }
    return result;
  }

  if (descriptor.validate) {
    const resultIssue = descriptor.validate(value);
    if (resultIssue) context.issues.push(issue(path, resultIssue.code, resultIssue.expected, value));
  }
  return context.mode !== "strict" && context.issues.length > validationStart
    ? clone(descriptor.defaultValue)
    : value;
}

export function getDefaultConfig() {
  return clone(ROOT_DEFAULT_CONFIG);
}

export function mergeWithDefaults(data) {
  return sanitizeConfig(data, { mode: "tolerant" }).data;
}

export function getExportableConfigKeys() {
  return Object.keys(CONFIG_SCHEMA).filter((path) => METADATA_INDEX.get(path)?.exportable);
}

export function getPersistedConfigPaths() {
  return Object.keys(CONFIG_SCHEMA).filter((path) => METADATA_INDEX.get(path)?.persisted);
}

export function getConfigPathMetadata(path) {
  const normalized = String(path || "").trim().replace(/\[\d+\]/g, "[]");
  if (METADATA_INDEX.has(normalized)) return METADATA_INDEX.get(normalized);
  const segments = normalized.split(".");
  let bestMetadata = null;
  let bestSpecificity = -1;
  for (const [pattern, metadata] of METADATA_INDEX.entries()) {
    const patternSegments = pattern.split(".");
    if (patternSegments.length !== segments.length) continue;
    let specificity = 0;
    let matches = true;
    for (let index = 0; index < segments.length; index++) {
      const patternSegment = patternSegments[index];
      const segment = segments[index];
      if (patternSegment === "*" || (patternSegment === "*[]" && segment.endsWith("[]"))) continue;
      if (patternSegment !== segment) {
        matches = false;
        break;
      }
      specificity += 1;
    }
    if (matches && specificity > bestSpecificity) {
      bestMetadata = metadata;
      bestSpecificity = specificity;
    }
  }
  return bestMetadata;
}

export function getSchemaPathIndex() {
  return Object.freeze(Object.fromEntries([...METADATA_INDEX.entries()]));
}

export function validateConfigSection(key, value, options = {}) {
  return validateConfig({ [key]: value }, { ...options, partial: true });
}

export function validateConfig(data, { mode = "strict", partial = false } = {}) {
  const context = { mode, issues: [] };
  if (!isObject(data)) return { valid: false, issues: [issue("", "type", "object", data)], data: getDefaultConfig() };

  for (const key of Object.keys(data)) {
    if (!Object.hasOwn(CONFIG_SCHEMA, key)) {
      context.issues.push(issue(key, "unknown", "known section", data[key]));
    }
  }

  const output = {};
  for (const [key, descriptor] of Object.entries(CONFIG_SCHEMA)) {
    if (Object.hasOwn(data, key)) output[key] = validateNode(data[key], descriptor, key, context);
    else if (!partial) output[key] = clone(descriptor.defaultValue);
  }
  return {
    valid: context.issues.length === 0,
    issues: context.issues,
    data: output,
  };
}

export function sanitizeConfig(data, options = {}) {
  return validateConfig(data, { ...options, mode: options.mode || "tolerant" });
}
