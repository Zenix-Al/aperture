import { stateManager } from "../../config/state.js";
import ui_html from "../assets/ui.html";
import framework from "aperture:framework";
import policy from "aperture:ui-policy";
import { renderSettingsTabs } from "../settings/tabs.js";
import { ensureModalCss } from "../helpers/cssInjector.js";
import { initModalUi } from "../settings/index.js";

let returnFocus = null;
export async function openModal() {
  returnFocus = stateManager.get("shadowRoot")?.activeElement || document.activeElement;
  ensureModalCss();
  await initModalUi();
  stateManager.get("shadowRoot").getElementById("tag-config-modal").style.display = "block";
  stateManager.get("shadowRoot").querySelector("#tag-config-modal button:not([disabled])")?.focus();
}
export function closeModal() {
  const shadowRoot = stateManager.get("shadowRoot");
  policy.hideTagSearchResults?.(shadowRoot?.getElementById("search-results"));
  shadowRoot.getElementById("tag-config-modal").style.display = "none";
  returnFocus?.focus?.(); returnFocus = null;
}

export function injectModal() {
  const modal = document.createElement("div");
  modal.id = "tag-config-modal";
  modal.innerHTML = `${ui_html}`;
  stateManager.get("shadowRoot").appendChild(modal);

  renderSettingsTabs(modal);
  modal.querySelector(".settings-framework-version").textContent = `${framework.name} v${framework.version}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Settings");
  const modalContent = modal.querySelector(".modal-content");

  modal.addEventListener("click", (e) => {
    // Close modal if the click is on the backdrop, not the content.
    const path = e.composedPath ? e.composedPath() : [];
    const clickedInsideModal = path.includes(modalContent);

    if (!clickedInsideModal) {
      closeModal();
    }
  });

  // Prevent host-page keyboard shortcuts from firing while the modal is open.
  const stopKeyLeak = (e) => {
    if (modal.style.display === "none") return;
    e.stopPropagation();
    if (e.type === "keydown" && e.key === "Escape") { e.preventDefault(); closeModal(); }
    if (e.type === "keydown" && e.key === "Tab") {
      const items = [...modal.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex='0']")].filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1], active = stateManager.get("shadowRoot").activeElement;
      if (first && e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (last && !e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  };

  modal.addEventListener("keydown", stopKeyLeak, true);
  modal.addEventListener("keyup", stopKeyLeak, true);
  modal.addEventListener("keypress", stopKeyLeak, true);
}
