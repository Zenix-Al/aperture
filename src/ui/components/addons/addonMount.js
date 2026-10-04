import project from "aperture:project";
const idPrefix = `${project.id}-${project.storageNamespace}`;
import { markThemedRoot } from "../../theme.js";
import { createEl } from "../../../utils/dom.js";

export function createAddonMountElement({ addonId, mountId, html = "", slot = "page.panel" } = {}) {
  const mountEl = createEl("div", {
    className: "aperture-addon-mount",
    attrs: {
      id: `${idPrefix}-addon-mount-${addonId}-${mountId}`,
      "data-addon-id": addonId,
      "data-addon-mount-id": mountId,
    },
  });

  if (
    String(slot || "")
      .trim()
      .toLowerCase() === "page.dock"
  ) {
    mountEl.style.display = "contents";
  }

  markThemedRoot(mountEl);
  mountEl.innerHTML = html;
  return mountEl;
}

export function insertAddonMountElement(host, mountEl, position) {
  const normalizedPosition = String(position || "append")
    .trim()
    .toLowerCase();

  if (normalizedPosition === "before") {
    host.parentNode?.insertBefore(mountEl, host);
    return;
  }

  if (normalizedPosition === "after") {
    host.parentNode?.insertBefore(mountEl, host.nextSibling || null);
    return;
  }

  if (normalizedPosition === "prepend") {
    host.insertBefore(mountEl, host.firstChild || null);
    return;
  }

  host.appendChild(mountEl);
}
