import { config } from "../../../src/config/state.js";
import { createEl } from "../../../src/utils/dom.js";

// A rich project component; the framework owns its listener and cancellation.
export default {
  mount({ container, listen }) {
    const button = createEl("button", { className: "config-button", text: "Show reading status", mount: container });
    const status = createEl("p", { attrs: { role: "status", "data-reading-settings-status": "" }, mount: container });
    listen("status", button, "click", () => { status.textContent = config.readingEnabled ? "Reading helper enabled" : "Reading helper disabled"; });
    return () => { button.remove(); status.remove(); };
  },
};
