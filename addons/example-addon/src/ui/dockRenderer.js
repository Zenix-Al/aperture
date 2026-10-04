import { escapeHtml } from "../../../shared/htmlUtils.js";
import dockHtmlTemplate from "./dock.html";

export function renderDockMarkup(runtime = {}) {
  return dockHtmlTemplate.replaceAll("__ADDON_NAME__", escapeHtml(runtime.addonName || "Example"));
}
