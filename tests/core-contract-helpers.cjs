const fs = require('fs');
const path = require('path');
const vm = require('vm');
const esbuild = require('esbuild');
const { Window } = require('happy-dom');
const { createFakeClock } = require('./helpers.cjs');
const ROOT = path.resolve(__dirname, '..');
const cache = new Map();
const MODULES = {
  factory: 'featureFactory', styled: 'createStyledFeature', observer: 'observer',
  queue: 'taskQueue', debounce: 'createDebouncedTask', frame: 'frameBudget',
  resources: 'resourceManager', listeners: 'listenerRegistry', styles: 'styleRegistry',
  logger: 'logger', health: 'featureHealth', state: 'StateManager', bridge: 'pageBridge',
  catalog: 'featureCatalog', scope: 'featureScope', detection: 'pageDetection',
  route: 'routeState', routeObserver: 'routeObserver', bootstrap: 'bootstrap',
  pageLifecycle: 'pageLifecycle', teardown: 'teardown',
};
function bundle({ id = 'fixture-app', debug = false } = {}) {
  const root = ROOT;
  const key = [root, id, debug].join('|');
  if (cache.has(key)) return cache.get(key);
  const modules = { ...MODULES, inputs: 'coreContext' };
  let source = Object.entries(modules).map(([name, file]) => `export * as ${name} from ${JSON.stringify(path.join(root, 'src/core', file + '.js'))};`).join('\n');
  const built = esbuild.buildSync({ stdin: { contents: source, resolveDir: root, sourcefile: 'core-contract-fixture.js' }, bundle: true, write: false, metafile: true,
    format: 'iife', globalName: '__apertureCore', loader: { '.html': 'text', '.css': 'text' },
    define: { __APERTURE_DEBUG__: String(debug), __APERTURE_PROJECT_ID__: JSON.stringify(id) }, logLevel: 'silent' });
  const result = { code: built.outputFiles[0].text, metafile: built.metafile };
  cache.set(key, result); return result;
}
function environment({ id = 'fixture-app', debug = false, fakeClock = true } = {}) {
  const window = new Window({ url: 'https://example.org/articles/one' });
  const logs = [], clock = createFakeClock();
  const console = Object.fromEntries(['log', 'warn', 'error', 'info', 'groupCollapsed', 'groupEnd'].map(level => [level, (...args) => logs.push({ level, args })]));
  let timestamp = 0;
  const sandbox = { window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event,
    MutationObserver: window.MutationObserver, location: window.location, history: window.history, navigator: window.navigator,
    AbortController, DOMException, URL, console, queueMicrotask, performance: { now: () => timestamp },
    setTimeout: fakeClock ? clock.setTimeout : setTimeout, clearTimeout: fakeClock ? clock.clearTimeout : clearTimeout,
    requestAnimationFrame: callback => (fakeClock ? clock.setTimeout : setTimeout)(callback, 0) };
  vm.createContext(sandbox); vm.runInContext(bundle({ id, debug }).code, sandbox);
  const api = sandbox.__apertureCore;
  let config;
  let state;
  { config = { enabled: true }; state = api.state.createStateManager({ shadowRoot: null, isArticle: true, nested: { count: 0 } });
    api.inputs.configureCoreContext({ id, getConfig: () => config, stateManager: state, pageDefinitions: { isArticle: { hostIncludes: ['example.org'], pathStartsWith: ['/articles/'] } } }); }
  return { api, window, sandbox, logs, clock, config, state, setTime(value) { timestamp = value; },
    async close() {
      api.routeObserver.resetRouteObserverForTests(); api.observer.removeAllObserverCallbacks(); api.listeners.removeAllListeners();
      await api.queue.disposeAllTaskQueues(); api.styles.clearAllStyles(); api.resources.resourceManager.cleanupAll();
      await window.close();
    } };
}
const plain = value => JSON.parse(JSON.stringify(value));
async function microtasks() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
module.exports = { ROOT, MODULES, bundle, environment, plain, microtasks };
