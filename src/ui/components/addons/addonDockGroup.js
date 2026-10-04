import project from "aperture:project";
const idPrefix = `${project.id}-${project.storageNamespace}`;
import { markThemedRoot } from "../../theme.js";
import { createEl } from "../../../utils/dom.js";

export function buildAddonDockGroupId(addonId) {
  return `${idPrefix}-addon-dock-${String(addonId || "")}`;
}

export function createAddonDockGroup(slot, addonId, buttons, { onAction } = {}) {
  if (!slot) return null;

  const groupId = buildAddonDockGroupId(addonId);
  let group = slot.querySelector(`#${groupId}`);
  if (!group) {
    group = createEl("div", {
      className: "aperture-page-dock-group",
      attrs: {
        id: groupId,
        "data-addon-id": addonId,
      },
      mount: slot,
    });
  }

  markThemedRoot(group);
  group.innerHTML = "";

  buttons.forEach((entry) => {
    const button = createEl("button", {
      className: "aperture-page-dock-btn",
      attrs: {
        type: "button",
        "data-addon-id": addonId,
        "data-action-id": entry.id,
      },
      text: entry.label,
      mount: group,
    });

    if (entry.variant === "secondary") {
      button.classList.add("secondary");
    } else if (entry.variant === "saved") {
      button.classList.add("saved");
    }

    button.disabled = Boolean(entry.disabled);
    if (entry.title) {
      button.title = entry.title;
    }

    if (typeof onAction === "function") {
      button.addEventListener("click", () => onAction(entry.id));
    }
  });

  return group;
}
