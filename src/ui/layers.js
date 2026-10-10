import ui from "aperture:ui";

// Keep the original layer spacing while letting each project clear its site UI.
const offsets = Object.freeze({ floating: -1000, dock: 20, settings: 3000, dialog: 3100, ...(__APERTURE_ADDONS__ ? { "addon-dialog": 3120 } : {}), toast: 3210 });
export function defineUiLayers(base = 10000) {
  if (!Number.isInteger(base) || base < 1000 || base > 2147483647 - offsets.toast) {
    throw new TypeError("UI zIndex must be an integer from 1000 to 2147480437");
  }
  return Object.freeze(Object.fromEntries(Object.entries(offsets).map(([role, offset]) => [role, base + offset])));
}
export const uiLayers = defineUiLayers(ui.zIndex);
export const layerDeclarations = Object.entries(uiLayers).map(([role, value]) => "--aperture-z-" + role + ":" + value + ";").join("");
