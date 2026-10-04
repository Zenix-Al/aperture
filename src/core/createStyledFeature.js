import { createFeature } from "./featureFactory.js";
import { acquireStyle, removeStyle } from "./styleRegistry.js";

function resolveStyleId(name, explicitId) {
  if (typeof explicitId === "string" && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `feature-${slug || "unnamed"}`;
}

export function createStyledFeature(
  name,
  {
    id,
    configPath,
    isEnabled,
    isApplicable,
    styleId,
    styleCss,
    styleTarget = "document",
    styleOwnerId = null,
    settingsUi,
    bootstrapMode,
    pageScopes,
    enable,
    disable,
  },
) {
  const resolvedStyleId = resolveStyleId(name, styleId);
  return createFeature(name, {
    id,
    configPath,
    isEnabled,
    isApplicable,
    settingsUi,
    bootstrapMode,
    pageScopes,
    enable: (context) => {
      acquireStyle(resolvedStyleId, styleCss, styleTarget, styleOwnerId);
      return enable ? enable(context) : null;
    },
    disable: (context) => {
      let result;
      try {
        result = disable ? disable(context) : null;
      } catch (error) {
        removeStyle(resolvedStyleId);
        throw error;
      }
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).finally(() => removeStyle(resolvedStyleId));
      }
      removeStyle(resolvedStyleId);
      return result;
    },
  });
}
