import project from "aperture:project";
const idPrefix = `${project.id}-${project.storageNamespace}`;
export function createAddonStyleElement(addonId, styleId, cssText) {
  const styleEl = document.createElement("style");
  styleEl.id = `${idPrefix}-addon-style-${addonId}-${styleId}`;
  styleEl.dataset.addonId = addonId;
  styleEl.dataset.addonStyleId = styleId;
  styleEl.textContent = cssText;
  return styleEl;
}
