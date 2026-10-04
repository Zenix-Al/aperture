import { uiLayers } from "../../layers.js";
import extensions from "aperture:addon-extensions";
import { resourceManager } from "../../../core/resourceManager.js";
import { markThemedRoot } from "../../theme.js";
import project from "aperture:project";
const hostId = value => `${project.id}-${project.storageNamespace}-${value}`;
function ownHost(host) { markThemedRoot(host); resourceManager.register(`ui:addon-host:${host.id}`, () => host.remove(), "ui:addon-hosts"); return host; }
import { createEl } from "../../../utils/dom.js";

export const ADDON_DOCK_SLOT_ID = "aperture-page-dock-addon-slot";
export const ADDON_DIALOG_HOST_ID = hostId("addon-dialog-host");
export const ADDON_PANEL_HOST_ID = hostId("addon-panel-host");
export const ADDON_FLOATING_HOST_ID = hostId("addon-floating-host");

export function getAddonDockSlotElement(shadowRoot) {
  if (!shadowRoot?.getElementById) return null;
  return shadowRoot.getElementById(ADDON_DOCK_SLOT_ID);
}

export function ensureAddonDialogHost() {
  let host = document.getElementById(ADDON_DIALOG_HOST_ID);
  if (host) return host;

  host = createEl("div", {
    attrs: {
      id: ADDON_DIALOG_HOST_ID,
    },
    style: {
      position: "fixed",
      inset: "0",
      zIndex: String(uiLayers["addon-dialog"]),
      pointerEvents: "none",
    },
  });
  document.body.appendChild(host);
  return ownHost(host);
}

export function ensureAddonPanelHost() {
  let host = document.getElementById(ADDON_PANEL_HOST_ID);
  if (host) return host;

  host = createEl("div", {
    attrs: {
      id: ADDON_PANEL_HOST_ID,
      "data-addon-slot": "page.panel",
    },
    mount: document.body,
  });
  return ownHost(host);
}

export function ensureAddonFloatingHost() {
  let host = document.getElementById(ADDON_FLOATING_HOST_ID);
  if (host) return host;

  host = createEl("div", {
    attrs: {
      id: ADDON_FLOATING_HOST_ID,
      "data-addon-slot": "page.floating",
    },
    style: {
      position: "fixed",
      inset: "0",
      zIndex: String(uiLayers.floating),
      pointerEvents: "auto",
    },
    mount: document.body,
  });
  return ownHost(host);
}

export function resolveAddonMountHost(slot, { shadowRoot } = {}) {
  const normalizedSlot = String(slot || "")
    .trim()
    .toLowerCase();

  const projectHost = extensions.resolveMountHost?.(normalizedSlot);
  if (projectHost) return projectHost;
  if (normalizedSlot === "page.dock") return getAddonDockSlotElement(shadowRoot);
  if (normalizedSlot === "page.panel") return ensureAddonPanelHost();
  if (normalizedSlot === "page.floating") return ensureAddonFloatingHost();
  return null;
}
