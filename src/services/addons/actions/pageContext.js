import policy from "aperture:addons";
import extensions from "aperture:addon-extensions";
import { stateManager } from "../../../config/state.js";
import { getRouteContext } from "../../../core/routeState.js";

function boundedText(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// Project fields are detached bounded JSON, never live page objects.
function sanitizeProjectFields(input) {
  let remaining = 256;
  const visit = (value, depth) => {
    if (--remaining < 0 || depth > 4) return null;
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return value.slice(0, 512);
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.slice(0, 32).map(entry => visit(entry, depth + 1));
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    return Object.fromEntries(Object.entries(value).slice(0, 32)
      .filter(([key]) => /^[a-z][a-z0-9_-]{0,63}$/i.test(key) && !["constructor", "prototype", "__proto__"].includes(key))
      .map(([key, entry]) => [key, visit(entry, depth + 1)]));
  };
  const fields = visit(input || {}, 0);
  return fields && !Array.isArray(fields) && JSON.stringify(fields).length <= 8192 ? fields : {};
}

function normalizePageContext() {
  const route = getRouteContext();
  let parsed = null;
  try {
    parsed = new URL(route.url || (typeof location !== "undefined" ? location.href : ""));
  } catch {
    parsed = null;
  }

  const pageFlags = route.pageFlags && typeof route.pageFlags === "object"
    ? route.pageFlags
    : {};
  const pageScopes = (policy.scopes || []).filter(([, key]) => pageFlags[key] === true || stateManager.get(key) === true)
    .map(([scope]) => scope);

  return {
    hostname: boundedText(parsed?.hostname || (typeof location !== "undefined" ? location.hostname : ""), 120),
    pathname: boundedText(parsed?.pathname || (typeof location !== "undefined" ? location.pathname : ""), 512),
    search: boundedText(parsed?.search || "", 512),
    hash: boundedText(parsed?.hash || "", 512),
    url: boundedText(route.url || parsed?.href || "", 1024),
    pageScopes,
    pageType: extensions.pageType?.(pageScopes) || pageScopes[0] || "unknown",
    routeGeneration: Math.max(0, Number(route.generation) || 0),
    ...(policy.legacyConfig
      ? extensions.pageFields?.({ pathname: parsed?.pathname || "", pageScopes }) || {}
      : { fields: sanitizeProjectFields(extensions.pageFields?.({ pathname: boundedText(parsed?.pathname || "", 512), pageScopes: [...pageScopes] })) }),
  };
}

export function validatePageContextPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? true
    : { ok: false, reason: "invalid_payload" };
}

export function validatePageContextResult(result) {
  const value = result?.value;
  if (!result?.ok || !value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "invalid_action_result" };
  }
  if (!policy.legacyConfig && (!value.fields || typeof value.fields !== "object" || Array.isArray(value.fields) || JSON.stringify(value.fields).length > 8192)) return { ok: false, reason: "invalid_action_result" };
  const stringLimits = {
    hostname: 120,
    pathname: 512,
    search: 512,
    hash: 512,
    url: 1024,
    ...(extensions.pageFieldLimits || {}),
  };
  if (!Object.entries(stringLimits).every(([key, limit]) => typeof value[key] === "string" && value[key].length <= limit)) {
    return { ok: false, reason: "invalid_action_result" };
  }
  if (!Array.isArray(value.pageScopes) || value.pageScopes.length > (policy.scopes || []).length
    || value.pageScopes.some((scope) => !(policy.scopes || []).some(([id]) => id === scope))) {
    return { ok: false, reason: "invalid_action_result" };
  }
  if (![...(policy.scopes || []).map(([id]) => id), "unknown"].includes(value.pageType)
    || !Number.isInteger(value.routeGeneration) || value.routeGeneration < 0) {
    return { ok: false, reason: "invalid_action_result" };
  }
  return true;
}

export function actionPageGetContext() {
  return { ok: true, value: normalizePageContext() };
}
