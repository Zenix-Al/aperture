const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { Window } = require('happy-dom');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const { renderFeatureManifest } = require('../scripts/featureManifest.cjs');
const ROOT = path.resolve(__dirname, '..');
const routes = {
  isArticle: { hostEquals: ['example.org'], pathStartsWith: ['/articles/'] },
  isIndex: { hostEquals: ['example.org'], pathEquals: ['/index'] },
  isSearch: { hostEquals: ['search.example.net'], hrefIncludes: ['?q=', '#results'] },
};
let cached;
async function bundle() {
  if (cached) return cached;
  const project = loadProject({ rootDir: ROOT });
  project.routes = routes;
  const manifest = renderFeatureManifest([{ relativePath: 'tests/fixtures/runtimeFeatures.js', exports: ['runtimeFastFeature', 'runtimeBodyFeature'] }], { outputFile: 'src/generated/features.generated.js' });
  const result = await esbuild.build({
    stdin: { contents: `export * from './src/main.js';
export * as app from './src/application.js';
export * as loader from './src/loader.js';
export * as route from './src/core/routeState.js';
export * as routeObserver from './src/core/routeObserver.js';
export * as detection from './src/core/pageDetection.js';
export * as scope from './src/core/featureScope.js';
export * as catalog from './src/core/featureCatalog.js';
export * as health from './src/core/featureHealth.js';
export * as resources from './src/core/resourceManager.js';
export * as styles from './src/core/styleRegistry.js';
export * as observer from './src/core/observer.js';
export * as queues from './src/core/taskQueue.js';
export * as teardown from './src/core/teardown.js';
export * as bootstrap from './src/core/bootstrap.js';
export * as dom from './src/utils/dom.js';`, resolveDir: ROOT, sourcefile: 'runtime-fixture.js' },
    loader: { '.css': 'text', '.html': 'text' }, bundle: true, write: false, metafile: true, format: 'iife', globalName: '__runtime',
    define: { __APERTURE_DEBUG__: 'false', __APERTURE_PROJECT_ID__: JSON.stringify(project.id) },
    plugins: [{ name: 'explicit-runtime-fixture-inputs', setup(build) {
      build.onLoad({ filter: /features\.generated\.js$/ }, args => path.resolve(args.path) === path.join(ROOT, 'src/generated/features.generated.js') ? { contents: manifest, resolveDir: path.dirname(args.path), loader: 'js' } : undefined);
      build.onLoad({ filter: /projects[\\/]example[\\/]application\.js$/ }, () => ({ contents: 'export default globalThis.__runtimeInputs;', loader: 'js' }));
    } }, projectInputs(project)], logLevel: 'silent',
  });
  cached = { code: result.outputFiles[0].text, metafile: result.metafile };
  return cached;
}
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
async function environment({ definition = {}, href = 'https://example.org/articles/one', body = true, fastTimeouts = false } = {}) {
  const window = new Window({ url: href });
  if (!body) window.document.body.remove();
  const config = { enabled: true }, logs = [], frames = new Map(); let frameSequence = 0;
  const fixture = { trace: [], clicks: [], commits: [], batches: [] };
  const inputs = { getConfig: () => config, ensureReady: async () => ({ state: 'degraded-readonly', canWrite: false }), ...definition };
  const sandbox = { window, document: window.document, location: window.location, history: window.history,
    Node: window.Node, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
    CustomEvent: window.CustomEvent, Event: window.Event, DOMException, AbortController, URL,
    performance, setTimeout: (callback, ms) => setTimeout(callback, fastTimeouts && ms === 10000 ? 25 : ms), clearTimeout, queueMicrotask,
    requestAnimationFrame(callback) { const id = ++frameSequence; frames.set(id, setTimeout(() => { frames.delete(id); callback(performance.now()); }, 2)); return id; },
    cancelAnimationFrame(id) { clearTimeout(frames.get(id)); frames.delete(id); },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'groupCollapsed', 'groupEnd'].map(level => [level, (...args) => logs.push({ level, args })])),
    __runtimeInputs: inputs, __runtimeFixture: fixture };
  vm.createContext(sandbox);
  try { vm.runInContext((await bundle()).code, sandbox); }
  catch (error) { await window.close(); throw error; }
  const api = sandbox.__runtime;
  return { window, sandbox, api, config, fixture, logs, frames,
    boot() { return api.startRuntime(); },
    async navigate(url, method = 'pushState') { window.history[method]({}, '', url); await delay(35); },
    async close() { await api.teardown.teardownAll('test'); for (const timer of frames.values()) clearTimeout(timer); await window.close(); },
  };
}
module.exports = { ROOT, routes, bundle, environment, deferred, delay };
