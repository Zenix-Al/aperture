import { createStyledFeature } from "../../../../src/core/createStyledFeature.js";
import { createResourceOwner, releaseOwner } from "../../../../src/core/resourceManager.js";
import { addListener } from "../../../../src/core/listenerRegistry.js";
import { updateConfig } from "../../../../src/services/settingsService.js";
import { markThemedRoot } from "../../../../src/ui/theme.js";
import project from "aperture:project";

const ownerId = "reading-desk:helper";
// This delay models cancellable page work. It never reads a network or account.
function waitForPage(signal) {
  return new Promise(resolve => {
    const finish = () => { window.clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = window.setTimeout(finish, 180);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

export const readingHelperFeature = createStyledFeature("Reading helper", {
  id: "reading-helper", configPath: "readingEnabled", pageScopes: ["isReading"], bootstrapMode: "waitForBody",
  styleId: ownerId, styleOwnerId: ownerId,
  styleCss: `[data-aperture-ui-owner="${project.id}:${project.storageNamespace}"].reading-desk-helper { padding: 1rem; border: 2px solid var(--aperture-accent, #893839); color: var(--aperture-text, #eee); background: var(--aperture-card, #222); }`,
  async enable(context) {
    await waitForPage(context.signal);
    if (context.signal.aborted) return;
    const owner = createResourceOwner(ownerId);
    const panel = document.createElement("aside");
    panel.className = "reading-desk-helper";
    panel.dataset.readingHelper = "true";
    markThemedRoot(panel);
    const label = document.createElement("p");
    label.textContent = "Reading helper is active on this route. Turn it off in Settings; reload to verify persistence.";
    const button = document.createElement("button");
    button.textContent = "Hide reading helper";
    panel.append(label, button);
    document.body.append(panel);
    owner.register(`${ownerId}:panel`, () => panel.remove());
    addListener(`${ownerId}:click`, button, "click", () => {
      void updateConfig(draft => { draft.readingEnabled = false; }).then(result => {
        if (!result.committed) label.textContent = "Settings could not be saved. Check storage readiness before retrying.";
      }).catch(() => { label.textContent = "Settings could not be saved. Check storage readiness before retrying."; });
    }, undefined, ownerId);
  },
  disable() { releaseOwner(ownerId); },
});
