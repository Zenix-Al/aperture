const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const ROOT = path.resolve(__dirname, '..');
const schema = {
  enabled: { type: 'boolean', defaultValue: true, exportable: true },
  count: { type: 'number', defaultValue: 2, min: 1, max: 50, integer: true, exportable: true, reloadRequired: true },
  preferences: { type: 'object', defaultValue: { title: 'hello', secret: 'private' }, exportable: true, properties: {
    title: { type: 'string', defaultValue: 'hello', maxLength: 50 },
    secret: { type: 'string', defaultValue: 'private', sensitive: true },
  }, additionalProperties: false },
};
async function bundle({ id, namespace, displayName, main = false, sample = false } = {}) {
  const project = loadProject({ rootDir: ROOT });
  if (id) project.id = id;
  if (namespace) project.storageNamespace = namespace;
  if (displayName) project.metadata.name = displayName;
  return esbuild.build({ stdin: { resolveDir: ROOT, contents: `
export * as settings from './src/services/settingsService.js';
export * as bootstrap from './src/services/storageBootstrapService.js';
export * as readiness from './src/services/storageReadiness.js';
export * as state from './src/config/state.js';
export * as schema from './src/config/schema.js';
export * as keys from './src/config/persistence.js';
export * as transfer from './src/services/configTransfer/index.js';
export * as storage from './src/services/storageAdapter.js';
export * as addonStorage from './src/services/addons/actions/families/storage.js';
export * as idb from './src/services/addons/idbStore.js';
export * as idbActions from './src/services/addons/actions/families/idb.js';
export * as prefs from './src/ui/settingsRuntime/prefs.js';
export * as health from './src/core/featureHealth.js';
${main ? "export * as main from './src/main.js'; export * as teardown from './src/core/teardown.js';" : ''}
` }, loader: { '.css': 'text', '.html': 'text' }, bundle: true, write: false, format: 'iife', globalName: '__storage', metafile: true,
    define: { __APERTURE_DEBUG__: 'false', __APERTURE_PROJECT_ID__: JSON.stringify(project.id) },
    plugins: [{ name: 'storage-fixture-policy', setup(build) {
      if (!sample) build.onLoad({ filter: /projects[\\/]example[\\/]settings\.js$/ }, () => ({ contents: 'export default globalThis.__settingsInputs;', loader: 'js' }));
    } }, projectInputs(project)], logLevel: 'silent' });
}
function manager(map = new Map(), hooks = {}) {
  const operations = [];
  const api = { info: { scriptHandler: 'test manager' },
    async getValue(key, fallback) { operations.push(['get', key]); if (hooks.get) { const result = await hooks.get(key, fallback, map); if (result?.handled) return result.value; } return map.has(key) ? structuredClone(map.get(key)) : fallback; },
    async setValue(key, value) { operations.push(['set', key]); if (hooks.set) { const result = await hooks.set(key, value, map); if (result?.handled) return result.value; } map.set(key, structuredClone(value)); },
    async deleteValue(key) { operations.push(['delete', key]); if (hooks.delete) { const result = await hooks.delete(key, map); if (result?.handled) return result.value; } map.delete(key); },
  };
  return { api, operations, map, hooks };
}
async function environment(options = {}) {
  const gm = options.gm || manager(options.map, options.hooks);
  const logs = [];
  const sandbox = { GM: options.missingGM ? undefined : gm.api, GM_info: { script: { version: 'test' } },
    __settingsInputs: options.definition || { schema, schemaVersion: 1, migrations: [] },
    console: Object.fromEntries(['log', 'warn', 'error', 'info', 'groupCollapsed', 'groupEnd'].map(key => [key, (...args) => logs.push(args)])),
    setTimeout, clearTimeout, queueMicrotask, performance, AbortController, URL,
  };
  vm.createContext(sandbox);
  const built = await bundle(options);
  vm.runInContext(built.outputFiles[0].text, sandbox);
  return { api: sandbox.__storage, gm, sandbox, built, logs };
}
const plain = value => JSON.parse(JSON.stringify(value));
module.exports = { ROOT, schema, bundle, manager, environment, plain };
