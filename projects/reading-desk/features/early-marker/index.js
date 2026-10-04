import { createFeature } from "../../../../src/core/featureFactory.js";
import { createResourceOwner, releaseOwner } from "../../../../src/core/resourceManager.js";
const ownerId = "reading-desk:early";
export const readingEarlyFeature = createFeature("Reading early marker", {
  id: "reading-early", bootstrapMode: "fast", pageScopes: ["isReading", "isShelf"],
  isEnabled: () => true,
  enable(context) {
    if (context.signal.aborted || !document.documentElement) return;
    const root = document.documentElement;
    const previous = root.getAttribute("data-reading-desk-ready");
    root.setAttribute("data-reading-desk-ready", "true");
    createResourceOwner(ownerId).register(`${ownerId}:marker`, () => {
      if (previous === null) root.removeAttribute("data-reading-desk-ready");
      else root.setAttribute("data-reading-desk-ready", previous);
    });
  },
  disable() { releaseOwner(ownerId); },
});
