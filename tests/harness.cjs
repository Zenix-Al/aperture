const path = require("path");

const fs = require("fs");

const assert = require("assert");

const childProcess = require("child_process");

const esbuild = require("esbuild");

const { Window } = require("happy-dom");

const { createAddonBridgeTransport, createDomSandbox, createFakeClock, createFakeGM, dispatchPageTransition } = require("./helpers.cjs");

const {
  generateFeatureManifest,
  checkFeatureManifest,
  renderFeatureManifest,
  validateFeatureManifestEntries,
} = require("../scripts/featureManifest.cjs");

const coreAudit = require("../scripts/core-source-audit.cjs");

const coreSizeGate = require("../scripts/core-size-gate.cjs");

const cssAudit = require("../scripts/css-audit.cjs");

const ROOT = path.join(__dirname, "..");

const TMP_DIR = process.env.APERTURE_TEST_TMP_DIR
  ? path.resolve(process.env.APERTURE_TEST_TMP_DIR)
  : path.join(__dirname, ".tmp");

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function loadModule(relativePath, options = {}) {
  const entry = path.join(ROOT, relativePath);
  const outFile = path.join(TMP_DIR, relativePath.replace(/[\\/]/g, '_') + '.cjs');
  let source = options.sourceReplacements ? Object.entries(options.sourceReplacements).reduce((text, [search,replacement]) => text.replace(search,replacement), fs.readFileSync(entry,'utf8')) : null;
  if (new Set(['src/core/featureFactory.js','src/core/styleRegistry.js','src/core/featureScope.js','src/core/featureCatalog.js','src/core/pageDetection.js','src/core/teardown.js']).has(relativePath)) source = 'import "../config/state.js";\n' + (source ?? fs.readFileSync(entry,'utf8'));
  childProcess.execFileSync(process.execPath, [path.join(__dirname, 'bundle-module.cjs'), JSON.stringify({ themeCss: options.themeCss, entryPoints: source === null ? [entry] : undefined, stdin: source === null ? undefined : { contents: source, resolveDir: path.dirname(entry), sourcefile: entry, loader: 'js' }, loader: { '.css': 'text', '.html': 'text', ...options.loader }, outfile: outFile })], { cwd: ROOT, windowsHide: true, stdio: 'pipe' });
  delete require.cache[require.resolve(outFile)];
  return require(outFile);
}

let passed = 0;

let failed = 0;

let testChain = Promise.resolve();

function runTest(name, testFn) {
  testChain = testChain.then(async () => {
    const previousRandom = Math.random;
    // This original chip-color assertion requires a reproducible preferred-tag
    // sample; production sampling and every assertion remain unchanged.
    if (name === "LATEST-FILTERS-EXPANSION-VERIFY-01 covers routes, lifecycle, presets, colors, and stale cleanup") Math.random = () => 0;
    try {
      await testFn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(err);
    } finally { Math.random = previousRandom; }
  });
}

function collectJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && entry.name === "dist") return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(filePath);
    return entry.isFile() && filePath.endsWith(".js") ? [filePath] : [];
  });
}

const { createStateManager } = loadModule("src/core/StateManager.js");

const { featureMatchesPageScopes } = loadModule("src/core/featureScope.js");

const {
  beginRoute,
  getRouteContext,
  normalizeRouteUrl,
  resetRouteStateForTests,
  setRoutePageFlags,
} = loadModule("src/core/routeState.js");

const { runBootstrapPipeline } = loadModule("src/core/bootstrap.js");

const {
  registerFeature,
  resetFeatureCatalogForTests,
  validateFeatureDescriptor,
} = loadModule("src/core/featureCatalog.js");

const {
  createFeature,
  normalizeFeatureBootstrapMode,
} = loadModule("src/core/featureFactory.js");

const {
  createResourceOwner,
  releaseOwner,
  getResourceSnapshot,
} = loadModule("src/core/resourceManager.js");

const { createTaskQueue } = loadModule("src/core/taskQueue.js");

const {
  clearHealthEventsForTests,
  getHealthDiagnostics,
  getHealthEvents,
  getAllFeatureStatuses,
  getRuntimeErrors,
  recordHealthEvent,
  registerDiagnosticsProvider,
  reportFeatureFailure,
  reportFeatureWarning,
  reportRuntimeError,
} = loadModule("src/core/featureHealth.js");

const { queryFirstBySelectors } = loadModule("src/utils/selectorQuery.js");

const {
  executeActionDescriptor,
  getActionSnapshot,
  registerAction,
} = loadModule("src/services/addons/actions/registry.js");

const {
  getRegisteredAddonActionSnapshot,
  invokeRegisteredAddonCoreAction,
  isAddonActionAllowed,
} = loadModule("src/services/addons/coreActions.js");

const { coerceSettingValue } = loadModule(
  "src/ui/renderers/coerceSettingValue.js",
);

const {
  getMetadataByConfigPath,
  getSettingsMetadataById,
  getSettingsMetadataByOwner,
  getSettingsMetadataBySection,
  getSettingsMetadataSnapshot,
  registerSettingsMetadata,
  resetSettingsMetadataForTests,
} = loadModule("src/ui/settings/metaRegistry.js");

const { renderSetting } = loadModule("src/ui/renderers/renderSetting.js");

const { createInput } = loadModule("src/ui/renderers/createInput.js");

const { setByPath } = loadModule("src/utils/objectPath.js");

const { flushQueuedToasts, showToast } = loadModule(
  "src/ui/components/toast.js",
);

const {
  isAddonOwnedObserverNode,
  normalizeObserverWaitSelector,
  unwatchAddonObserver,
  waitForAddonObserver,
} = loadModule(
  "src/services/addons/observer.js",
);

const {
  ADDON_UI_SLOT_POLICY,
  normalizeAddonMountSlot,
  sanitizeAddonCss,
  sanitizeAddonHtml,
} = loadModule("src/services/addons/uiSanitizer.js");

const { createAddonDockGroup } = loadModule(
  "src/ui/components/addons/addonDockGroup.js",
);

const { invokeOptionalCoreAction } = loadModule("addons/shared/apiFallback.js");

function createFakeElement(tagName, doc) {
  return doc.createElement(tagName);
}

function createFakeDocument({ withBody = false } = {}) {
  const doc = new Window().document;
  if (!withBody) doc.body.remove();
  return doc;
}


let finished = false;
process.on("exit", () => {
  if (finished) return;
  console.error("Test run stopped early: unsettled tests remain (" + passed + " passed, " + failed + " failed).");
  process.exitCode = 1;
});

function finish() {
  return testChain.then(() => {
    finished = true;
    console.log("\nTest results: " + passed + " passed, " + failed + " failed");
    if (failed > 0) process.exitCode = 1;
  });
}

module.exports = { ADDON_UI_SLOT_POLICY, ROOT, TMP_DIR, Window, assert, beginRoute, checkFeatureManifest, childProcess, clearHealthEventsForTests, coerceSettingValue, collectJavaScriptFiles, coreAudit, coreSizeGate, createAddonBridgeTransport, createAddonDockGroup, createDomSandbox, createFakeClock, createFakeDocument, createFakeElement, createFakeGM, createFeature, createInput, createResourceOwner, createStateManager, createTaskQueue, cssAudit, dispatchPageTransition, executeActionDescriptor, featureMatchesPageScopes, finish, flushQueuedToasts, fs, generateFeatureManifest, getActionSnapshot, getAllFeatureStatuses, getHealthDiagnostics, getHealthEvents, getMetadataByConfigPath, getRegisteredAddonActionSnapshot, getResourceSnapshot, getRouteContext, getRuntimeErrors, getSettingsMetadataById, getSettingsMetadataByOwner, getSettingsMetadataBySection, getSettingsMetadataSnapshot, invokeOptionalCoreAction, invokeRegisteredAddonCoreAction, isAddonActionAllowed, isAddonOwnedObserverNode, loadModule, normalizeAddonMountSlot, normalizeFeatureBootstrapMode, normalizeObserverWaitSelector, normalizeRouteUrl, path, queryFirstBySelectors, recordHealthEvent, registerAction, registerDiagnosticsProvider, registerFeature, registerSettingsMetadata, releaseOwner, renderFeatureManifest, renderSetting, reportFeatureFailure, reportFeatureWarning, reportRuntimeError, resetFeatureCatalogForTests, resetRouteStateForTests, resetSettingsMetadataForTests, runBootstrapPipeline, runTest, sanitizeAddonCss, sanitizeAddonHtml, setByPath, setRoutePageFlags, showToast, unwatchAddonObserver, validateFeatureDescriptor, validateFeatureManifestEntries, waitForAddonObserver };
