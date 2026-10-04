import { layerDeclarations } from "./layers.js";
import startupCss from "./assets/startup.css";
// Selected values and owned-root delivery; original style registry owns the sheet.
import project from "aperture:project";
import selectedTheme from "aperture:theme";
import { acquireStyle, getStyleRegistrySnapshot } from "../core/styleRegistry.js";
const owner = `${project.id}:${project.storageNamespace}`;
const styleId = `ui-theme:${owner}`;
export function markThemedRoot(root) {
  if (!root) return root;
  root.setAttribute("data-aperture-ui-owner", owner);
  if (!getStyleRegistrySnapshot()[styleId]?.attached) {
    const declarations = (selectedTheme || "").replace(/^\s*:root\s*\{/, "").replace(/\}\s*$/, "");
    const scope = `[data-aperture-ui-owner="${owner}"].aperture-toast-container`;
    const toastCss = [...startupCss.matchAll(/(?:#toast-container|\.toast(?:\.show)?)\s*\{[^{}]*\}/g)].map(match => match[0].replace(/^#toast-container/, scope).replace(/^\.toast/, `${scope} .toast`)).join("\n");
    acquireStyle(styleId, `[data-aperture-ui-owner="${owner}"]{${declarations}${layerDeclarations}}\n${toastCss}`, "document", "ui:theme");
  }
  return root;
}

export function themeValue(role, fallback) { return selectedTheme ? `var(--aperture-${role}, ${fallback})` : fallback; }
