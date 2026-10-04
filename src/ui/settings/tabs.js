import ui from "aperture:ui";
import { createEl } from "../../utils/dom.js";
import { resourceManager } from "../../core/resourceManager.js";
import { addListener } from "../../core/listenerRegistry.js";
import { reportFeatureWarning } from "../../core/featureHealth.js";

const reserved = new Set(["general", "global", "addins", "addons", "constructor", "prototype", "__proto__"]);
function identifier(value) {
  if (typeof value !== "string" || !/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(value) || reserved.has(value)) throw new TypeError("Invalid or reserved settings tab/section ID");
  return value;
}
function object(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(message);
}
export function defineSettingsTabs(input = {}) {
  const containers = { global: "global-settings-container" };
  const settings = { ...input.sections };
  const general = { id: "general", label: "General", sections: [{ id: "global" }] };
  const addons = { id: "addins", label: "Add-ons", sections: [] };
  if (input.tabs !== undefined && !Array.isArray(input.tabs)) throw new TypeError("UI tabs must be an array");
  const ids = new Set();
  const tabs = (input.tabs || []).map(tab => {
    object(tab, "UI tab must be an object");
    for (const key of Object.keys(tab)) if (!["id", "label", "order", "sections", "component"].includes(key)) throw new TypeError("Unknown UI tab field: " + key);
    const id = identifier(tab.id);
    if (ids.has(id)) throw new TypeError("Duplicate settings tab ID: " + id);
    ids.add(id);
    if (typeof tab.label !== "string" || !tab.label.trim() || tab.label.length > 200) throw new TypeError("UI tab requires a label");
    if (tab.order !== undefined && !Number.isFinite(tab.order)) throw new TypeError("UI tab order must be finite");
    if (tab.component !== undefined && (!tab.component || typeof tab.component.mount !== "function")) throw new TypeError("UI tab component requires mount");
    const sections = [];
    if (tab.sections !== undefined) object(tab.sections, "Tab sections must be an object map");
    for (const [sectionId, section] of Object.entries(tab.sections || {})) {
      identifier(sectionId); object(section, "Section requires metadata");
      if (Object.hasOwn(containers, sectionId)) throw new TypeError("Duplicate settings section ID: " + sectionId);
      for (const key of Object.keys(section)) if (!["label", "settings"].includes(key)) throw new TypeError("Unknown section field: " + key);
      if (section.label !== undefined && typeof section.label !== "string") throw new TypeError("Section label must be text");
      if (section.settings !== undefined) {
        object(section.settings, "Section settings must be an object map");
        if (Object.hasOwn(settings, sectionId)) throw new TypeError("Duplicate section settings: " + sectionId);
        settings[sectionId] = section.settings;
      }
      containers[sectionId] = "settings-section-" + sectionId;
      sections.push({ id: sectionId, label: section.label });
    }
    return { ...tab, sections };
  }).sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const sectionId of new Set([...Object.keys(input.sectionContainers || {}), ...Object.keys(settings)])) {
    if (sectionId === "global" || Object.hasOwn(containers, sectionId)) continue;
    identifier(sectionId);
    containers[sectionId] = "settings-section-" + sectionId;
    general.sections.push({ id: sectionId });
  }
  return { tabs: [general, addons, ...tabs], containers, settings };
}
export const settingsTabs = defineSettingsTabs(ui);

export function renderSettingsTabs(modal) {
  const nav = modal.querySelector("#settings-nav-core");
  const main = modal.querySelector(".settings-main");
  for (const tab of settingsTabs.tabs) {
    const panelId = "settings-panel-" + tab.id;
    createEl("button", { text: tab.label, className: "settings-nav-item", attrs: { type: "button", "data-target": panelId }, mount: nav });
    let panel = modal.querySelector("#" + panelId);
    if (!panel) panel = createEl("div", { className: "settings-panel", attrs: { id: panelId }, mount: main });
    main.appendChild(panel);
    let wrapper = panel.querySelector(".settings-wrapper-inner");
    if (!wrapper) wrapper = createEl("div", { className: "settings-wrapper-inner", mount: panel });
    for (const section of tab.sections) {
      if (section.label) createEl("div", { className: "config-header", text: section.label, mount: wrapper });
      createEl("div", { attrs: { id: settingsTabs.containers[section.id] }, mount: wrapper });
    }
    if (tab.component) createEl("div", { className: "settings-tab-content", attrs: { "data-settings-component": tab.id }, mount: wrapper });
  }
}

export function mountSettingsTabComponents(shadowRoot) {
  for (const tab of settingsTabs.tabs.filter(tab => tab.component)) {
    const container = shadowRoot.querySelector('[data-settings-component="' + tab.id + '"]');
    if (!container || container.dataset.mounted) continue;
    container.dataset.mounted = "1";
    const ownerId = "ui:tab:" + tab.id;
    const resources = resourceManager.createOwner(ownerId);
    const controller = new AbortController();
    let cleanup;
    resourceManager.register(ownerId + ":mount", () => {
      controller.abort();
      try { cleanup?.(); } finally { resources.release(); container.replaceChildren(); delete container.dataset.mounted; }
    }, "ui:settings-modal");
    const context = {
      container, signal: controller.signal, ownerId,
      resources: { register: (id, dispose) => {
        if (controller.signal.aborted) { dispose(); return null; }
        return resources.register(ownerId + ":component:" + id, dispose);
      } },
      listen: (id, target, type, callback, options) => {
        if (controller.signal.aborted) return;
        return addListener(ownerId + ":listener:" + id, target, type, callback, options, ownerId);
      },
    };
    const fail = error => {
      reportFeatureWarning("Settings tab " + tab.id, error, "mount");
      if (!controller.signal.aborted) { resourceManager.cleanup(ownerId + ":mount"); container.textContent = "This panel could not be loaded."; container.dataset.mounted = "failed"; }
    };
    try {
      Promise.resolve(tab.component.mount(context)).then(dispose => {
        if (typeof dispose !== "function") throw new TypeError("Tab mount must return a cleanup function");
        if (controller.signal.aborted) dispose(); else cleanup = dispose;
      }).catch(fail);
    } catch (error) { fail(error); }
  }
}
