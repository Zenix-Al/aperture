/* global __ADDON_ID__, __ADDON_NAME__, __ADDON_VERSION__, __ADDON_DESCRIPTION__, __ADDON_CAPABILITIES__, __ADDON_REQUIRES_CORE__, __ADDON_PAGE_SCOPES__, __ADDON_RUNTIME_MODE__, __ADDON_MATCHES__ */
import { createCoreAdaptor } from "../../addons/shared/runtimeKit.js";
import { createAddonRuntimeLifecycle } from "../../addons/shared/runtimeLifecycle.js";
import { ADDON_PROJECT_ID } from "../../addons/shared/contract.js";

const core = createCoreAdaptor(__ADDON_ID__);
const mountId = "reading-note";
const styleId = "reading-note-style";
let unbind = () => {};
const checked = result => { if (!result?.ok) throw new Error(result?.reason || "core_unavailable"); return result.value; };
const fail = error => core.updateStatus("broken", `Reading note unavailable: ${String(error?.message || "request_failed").slice(0, 120)}`);

async function render(context) {
    const saved = await core.invokeCoreAction("storage.get", { key: "bookmark" });
    const settings = await core.invokeCoreAction("storage.get", { key: "settings" });
    checked(settings);
    checked(saved);
    if (!context.isCurrent()) return;
    checked(await core.invokeCoreAction("ui.style.register", { styleId, cssText: ".reading-note { --aperture-accent: #52799b; padding: 1rem; color: var(--aperture-text, #eee); background: var(--aperture-card, #222); border: 2px solid var(--aperture-accent); } .reading-note button:focus-visible { outline: 3px solid var(--aperture-focus, #fff); }" }));
    if (!context.isCurrent()) return;
    checked(await core.invokeCoreAction("ui.mount", { mountId, slot: "page.panel", html: `<section class="reading-note"><p>${settings.value?.reminder === false ? "Reading bookmark" : saved.value ? "A reading bookmark is saved." : "Save this reading route as a bookmark."}</p><button type="button" data-reading-save="true">Save bookmark</button><p data-reading-status="true" role="status"></p></section>` }));
    if (!context.isCurrent()) return;
    const click = async event => {
      const button = event.target?.closest?.("[data-reading-save]");
      const root = button?.closest?.("[data-aperture-ui-owner]");
      if (!button || root?.dataset.apertureUiOwner !== ADDON_PROJECT_ID || root?.dataset.addonId !== __ADDON_ID__) return;
      button.disabled = true;
      const result = await core.invokeCoreAction("storage.set", { key: "bookmark", value: { path: location.pathname } });
      if (!context.isCurrent()) return;
      root.querySelector("[data-reading-status]").textContent = result.ok ? "Bookmark saved; reload to verify." : `Could not save: ${result.reason || "request_failed"}`;
      button.disabled = false;
    };
    const listener = event => { void click(event).catch(fail); };
    document.addEventListener("click", listener);
    lifecycle.registerResource("reading-note:click", () => document.removeEventListener("click", listener), "listener");
    core.updateStatus("installed", "Reading bookmark ready.");
}
async function cleanup() {
    lifecycle.releaseResource("reading-note:click");
    await core.invokeCoreAction("ui.unmount", { mountId });
    await core.invokeCoreAction("ui.style.unregister", { styleId });
}
const lifecycle = createAddonRuntimeLifecycle({
  addonId: __ADDON_ID__,
  onEnable: render,
  onDisable: cleanup,
  async onRefresh(context) { await cleanup(); if (context.isCurrent()) await render(context); },
  async onTeardown() { await cleanup(); unbind(); },
  onTeardownAcknowledged: () => { core.notifyTeardownComplete("reading-desk-teardown"); core.dispose(); },
});

async function start() {
  let ping;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    ping = await core.waitForCorePing(375);
    if (ping.ok) break;
  }
  if (!ping.ok) { core.dispose(); return; } // Core-required: no standalone UI or writes.
  unbind = core.bindAddonCommands(detail => {
    if (detail.command === "before-page-change") lifecycle.invalidate("route-change", detail.routeContext);
    else if (["enable", "disable", "refresh", "teardown"].includes(detail.command)) void lifecycle[detail.command](detail).catch(fail);
  });
  core.registerAddon({ id: __ADDON_ID__, name: __ADDON_NAME__, version: __ADDON_VERSION__, description: __ADDON_DESCRIPTION__, capabilities: __ADDON_CAPABILITIES__, requiresCore: __ADDON_REQUIRES_CORE__, pageScopes: __ADDON_PAGE_SCOPES__, runtimeMode: __ADDON_RUNTIME_MODE__, matches: __ADDON_MATCHES__, status: "installed", panelTitle: "Reading bookmark", panelBody: "This core-required add-on owns one bookmark and one panel.", panelSettingsStorageKey: "settings", panelSettingsDefaults: { reminder: true }, panelSettings: [{ type: "toggle", path: "reminder", text: "Show bookmark reminder" }] });
  const access = await core.getAddonAccess();
  if (access.ok && !access.value?.blocked && access.value?.enabled !== false) await lifecycle.enable();
}
void start().catch(fail);
