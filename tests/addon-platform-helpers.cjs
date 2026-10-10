const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { Window } = require('happy-dom');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const { manager } = require('./storage-helpers.cjs');
const { locksFor } = require('./config-lock-helpers.cjs');
const ROOT = path.resolve(__dirname, '..');
const descriptor = require('../projects/example/addons.manifest.json').addons[0];
async function bundle({ projectId, policy = {}, theme, routePrefix, addonUpdates, uiDefinition } = {}) {
  const project = loadProject({ rootDir: ROOT });
  if (projectId) project.id = projectId;
  if (addonUpdates) project.addonUpdates = addonUpdates;
  if (routePrefix) project.routes.isExample.pathStartsWith = [routePrefix];
  if (theme) project.themeCss = require('../scripts/themeContract.cjs').validateTheme(require('node:fs').readFileSync(path.join(ROOT, 'themes', theme, 'index.css'), 'utf8')).css;
  return esbuild.build({ stdin: { resolveDir: ROOT, contents: `
export * as testPolicy from 'aperture:addon-input';
export * as main from './src/main.js';
export * as service from './src/services/addonsService.js';
export * as invocation from './src/services/addons/invocation.js';
export * as registry from './src/services/addons/registry.js';
export * as catalog from './src/services/addons/catalog.js';
export * as bridge from './src/services/addons/bridgeServer.js';
export * as protocol from './src/services/addons/protocol.js';
export * as contract from './addons/shared/contract.js';
export * as client from './addons/shared/coreBridge.js';
export * as actions from './src/services/addons/actions/composition.js';
export * as state from './src/config/state.js';
export * as settings from './src/services/settingsService.js';
export * as ui from './src/services/addons/uiHost.js';
export * as modal from './src/ui/components/modal.js';
export * as tabs from './src/ui/settings/tabs.js';
export * as settingsController from './src/ui/components/addons/settingsController.js';
export * as prefs from './src/ui/settingsRuntime/prefs.js';
export * as teardown from './src/core/teardown.js';
export * as example from './addons/example-addon/src/app/createExampleAddonApp.js';
` }, bundle: true, write: false, metafile: true, format: 'iife', globalName: '__addons',
    loader: { '.css': 'text', '.html': 'text' },
    define: { __APERTURE_DEBUG__: 'false', __APERTURE_PROJECT_ID__: JSON.stringify(project.id) },
    plugins: [{ name: 'addon-project-policy-fixture', setup(build) {
      if (uiDefinition) build.onLoad({ filter: /projects[\\/]example[\\/]ui\.js$/ }, () => ({ contents: uiDefinition, loader: "js", resolveDir: ROOT }));
      build.onResolve({ filter: /^aperture:addon-input$/ }, () => ({ path: 'policy', namespace: 'addon-test-policy' }));
      build.onLoad({ filter: /.*/, namespace: 'addon-test-policy' }, () => ({ contents: `export default ${JSON.stringify(policy)};`, loader: 'js' }));
    } }, projectInputs(project)], logLevel: 'silent' });
}
async function environment(options = {}) {
  const window = options.window || new Window({ url: 'http://localhost/' });
  const gm = manager(options.map, options.hooks), logs = [];
  const sandbox = { window, document: window.document, location: window.location, history: window.history,
    isSecureContext: true, navigator: { locks: locksFor(gm.map) },
    Node: window.Node, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent, Event: window.Event, DOMException, AbortController, URL,
    TextEncoder, performance, setTimeout, clearTimeout, queueMicrotask, GM: gm.api,
    requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 1), cancelAnimationFrame: clearTimeout,
    console: Object.fromEntries(['log','warn','error','info','groupCollapsed','groupEnd'].map(level => [level, (...args) => logs.push(args)])) };
  vm.createContext(sandbox);
  const built = await bundle(options);
  try { vm.runInContext(built.outputFiles[0].text, sandbox); } catch (error) { await window.close(); throw error; }
  const api = sandbox.__addons;
  await api.main.startRuntime();
  const client = api.client.createCoreBridge('example-addon');
  const ping = await client.waitForCorePing(200);
  return { api, client, ping, window, gm, built, logs,
    register(overrides = {}) { client.registerAddon({ ...descriptor, status: 'installed', ...overrides }); },
    async close() { await api.teardown.teardownAll('test'); if (!options.window) await window.close(); },
  };
}
module.exports = { ROOT, descriptor, bundle, environment };
