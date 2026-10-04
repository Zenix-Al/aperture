const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { environment, bundle, deferred, delay, ROOT } = require('./runtime-helpers.cjs');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { checkProjectFeatureManifest, buildFeatureManifestState, generateFeatureManifest, checkFeatureManifest } = require('../scripts/featureManifest.cjs');

test('actual main/loader graph uses non-product inputs and retains original entry/loader exports', async () => {
  const built = await bundle();
  const inputs = Object.keys(built.metafile.inputs).map(value => value.replaceAll('\\', '/'));
  assert(inputs.includes('src/main.js')); assert(inputs.includes('src/loader.js'));
  assert(!inputs.some(value => /src\/(features|ui|services)\/|src\/config\/(defaults|pageDefinitions)|addons\//.test(value)));
  assert(!/isLatest|startLatestCapture|refreshLatestCapture/i.test(built.code));
  const e = await environment();
  try {
    assert.equal(typeof e.api.startRuntime, 'function');
    assert.deepEqual(Object.keys(e.api.loader).sort(), ['isFeatureAllowedOnCurrentPage', 'loadBodyBootstrapFeatures', 'loadFastBootstrapFeatures', 'loadFeatures', 'reconcileFeatures', 'refreshFastBootstrapFeatures'].sort());
    await e.boot(); assert.equal(e.api.teardown.getRuntimeState(), 'running');
  } finally { await e.close(); }
});

test('readiness is shared, startup is memoized, early work precedes body lifecycles and settings retain owner IDs', async () => {
  const ready = deferred(), trace = [], contributions = []; let readinessCalls = 0;
  const e = await environment({ definition: {
    ensureReady: () => { readinessCalls++; return ready.promise; },
    earlyWork: context => { trace.push('early'); assert.equal(context.phase, 'initial'); assert.equal(context.features.length, 1); assert(context.isCurrent()); },
    settingsUi: { contributeToSection: (...args) => contributions.push(args) },
    ui: { init: () => trace.push('ui'), flushToasts: () => trace.push('toasts') },
    extensions: { init: () => trace.push('extensions') },
  } });
  try {
    const first = e.boot(); assert.equal(e.boot(), first);
    await delay(); assert.equal(readinessCalls, 1); assert.equal(e.fixture.trace.length, 0); assert.equal(e.api.route.getRouteContext().generation, 0);
    assert.equal(contributions.length, 2); assert.equal(contributions[0][2], 'feature:runtime-fast');
    ready.resolve({ state: 'degraded-readonly', canWrite: false }); await first;
    assert.deepEqual(trace, ['early', 'extensions', 'ui', 'toasts']);
    assert.deepEqual(e.fixture.trace, ['enable:runtime-fast:1', 'enable:runtime-body:1']);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
  } finally { await e.close(); }
});

test('required readiness rejection blocks both feature phases and cannot be masked by a failed notice', async () => {
  let notice = 0;
  const e = await environment({ definition: { ensureReady: async () => { throw new Error('storage probe failed'); }, onStorageFailure: () => { notice++; throw new Error('notice unavailable'); } } });
  try {
    const [fast, body] = await e.boot(); assert.equal(fast.status, 'failed'); assert.equal(body, null);
    assert.equal(notice, 1); assert.equal(e.fixture.trace.length, 0); assert.equal(e.api.route.getRouteContext().generation, 0);
    assert.equal(e.api.health.getFeatureStatus('Bootstrap').status, 'failing');
  } finally { await e.close(); }
});

test('missing readiness is an explicit required failure; runtime never silently invents writable storage', async () => {
  const e = await environment({ definition: { ensureReady: undefined } });
  try { assert.equal((await e.boot())[0].status, 'failed'); assert.equal(e.fixture.commits.length, 0); } finally { await e.close(); }
});

test('unsettled or upgrade-required readiness cannot authorize a feature phase', async () => {
  for (const state of ['loading', 'upgrade-required', undefined]) {
    const e = await environment({ definition: { ensureReady: async () => ({ state }) } });
    try { assert.equal((await e.boot())[0].status, 'failed'); assert.equal(e.fixture.commits.length, 0); } finally { await e.close(); }
  }
});

test('application validates narrow inputs and accepts project JavaScript route predicates and state seeds', async () => {
  for (const definition of [{ arbitrary: true }, { routes: [] }, { state: [] }, { earlyWork: 'javascript string' }, { ui: { unknown: () => {} } }, { extensions: { init: false } }, { routes: { badKey: {} } }, { stateManager: {} }]) {
    await assert.rejects(environment({ definition }), /Unknown|must be|Invalid|requires/);
  }
  const e = await environment({ definition: { state: { projectCounter: 3 }, routes: { isOverlap: { match: url => url.hostname === 'example.org' } } } });
  try { await e.boot(); assert.equal(e.api.app.stateManager.get('projectCounter'), 3); assert.equal(e.api.app.stateManager.get('isOverlap'), true); assert.equal(e.api.app.stateManager.get('isArticle'), true); } finally { await e.close(); }
});

test('navigation during pre-body early work aborts the old task but does not start DOM features', async () => {
  let initial; const cancelled = deferred();
  const e = await environment({ body: false, definition: { earlyWork: context => {
    if (context.phase !== 'initial') return;
    initial = context; context.signal.addEventListener('abort', cancelled.resolve, { once: true }); return cancelled.promise;
  } } });
  try {
    const startup = e.boot(); await delay(10); assert(initial);
    await e.navigate('/articles/before-body'); assert(initial.signal.aborted); assert.equal(e.fixture.trace.length, 0);
    assert.equal(e.api.route.getRouteContext().generation, 2);
    e.window.document.documentElement.appendChild(e.window.document.createElement('body')); await startup;
    assert.deepEqual(e.fixture.trace, ['enable:runtime-fast:2', 'enable:runtime-body:2']);
  } finally { cancelled.resolve(); await e.close(); }
});

test('pagehide while readiness is pending prevents late startup after the prerequisite resolves', async () => {
  const ready = deferred(); const e = await environment({ definition: { ensureReady: () => ready.promise } });
  try {
    const startup = e.boot(); await delay(5); e.window.dispatchEvent(new e.window.Event('pagehide')); await delay(10);
    ready.resolve({ state: 'ready' }); await startup;
    assert.equal(e.api.teardown.getRuntimeState(), 'stopped'); assert.equal(e.fixture.commits.length, 0); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 0);
  } finally { ready.resolve({ state: 'ready' }); await e.close(); }
});

test('optional extension scope consumers receive current project predicates after navigation and BFCache', async () => {
  const contexts = []; const e = await environment({ definition: { extensions: { refresh: context => contexts.push(context) } } });
  try {
    await e.boot(); await e.navigate('/index'); await e.navigate('/articles/again');
    assert.equal(contexts[0].pageFlags.isIndex, true); assert.equal(contexts[0].pageFlags.isArticle, false);
    assert.equal(contexts[1].pageFlags.isArticle, true);
    const show = new e.window.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); e.window.dispatchEvent(show); await delay(35);
    assert.equal(contexts[2].pageFlags.isArticle, true);
    assert(e.api.scope.featureMatchesPageScopes({ pageScopes: ['isArticle'] }));
  } finally { await e.close(); }
});

test('optional UI/extensions/settings failures report degraded diagnostics while the same original feature lifecycle runs', async () => {
  const fail = () => { throw new Error('optional unavailable'); };
  const e = await environment({ definition: { settingsUi: { contributeToSection: fail }, ui: { init: fail, flushToasts: fail }, extensions: { init: fail } } });
  try {
    const [fast, body] = await e.boot(); assert.equal(fast.status, 'degraded'); assert.equal(body, undefined);
    assert.equal(e.api.health.getFeatureStatus('Runtime Body').status, 'running');
    assert(e.api.health.getHealthEvents().some(event => event.message.includes('loader.settings-ui')));
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
  } finally { await e.close(); }
});

test('early work receives cancellation and a bounded original bootstrap timeout without blocking body recovery', async () => {
  let context;
  const e = await environment({ fastTimeouts: true, definition: { earlyWork: supplied => { context = supplied; return new Promise(() => {}); } } });
  try {
    assert.equal((await e.boot())[0].status, 'degraded'); await delay(35); assert(context.signal.aborted); assert.equal(context.isCurrent(), false);
    assert.equal(e.api.health.getFeatureStatus('Runtime Fast').status, 'running');
    assert(e.api.health.getHealthEvents().some(event => event.message.includes('loader.early-work')));
  } finally { await e.close(); }
});

test('same-route no-op; same-scope push/replace/hash generations release and re-enable owned resources', async () => {
  const e = await environment();
  try {
    await e.boot(); const initial = e.api.route.getRouteContext();
    await e.navigate('/articles/one'); assert.equal(e.api.route.getRouteContext().generation, initial.generation); assert.equal(e.fixture.trace.length, 2);
    await e.navigate('/articles/two'); assert(initial.signal.aborted); assert.equal(e.api.route.getRouteContext().generation, 2);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
    assert(e.fixture.trace.includes('disable:runtime-fast:2')); assert(e.fixture.trace.includes('enable:runtime-fast:2'));
    await e.navigate('/articles/two?q=x', 'replaceState'); await e.navigate('/articles/two?q=x#result');
    assert.equal(e.api.route.getRouteContext().generation, 4);
    e.window.document.querySelector('[data-runtime-feature="runtime-body"]').click(); assert.deepEqual(e.fixture.clicks, ['runtime-body']);
    assert.equal(Object.keys(e.api.styles.getStyleRegistrySnapshot()).length, 2);
  } finally { await e.close(); }
});

test('off-scope navigation disables both buckets and history return enables once', async () => {
  const e = await environment();
  try {
    await e.boot(); await e.navigate('/index'); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 0);
    assert.equal(e.api.app.stateManager.get('isIndex'), true); assert.equal(Object.keys(e.api.styles.getStyleRegistrySnapshot()).length, 0);
    e.window.history.replaceState({}, '', '/articles/return'); e.window.dispatchEvent(new e.window.Event('popstate')); await delay(35);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
    assert.equal(e.api.route.getRouteContext().generation, 3);
  } finally { await e.close(); }
});

test('rapid A to B to A coalesces latest route and stale early work cannot reconcile', async () => {
  const waiting = deferred(); let delayedContext; const phases = [];
  const e = await environment({ definition: { earlyWork: context => { phases.push(context.url); if (context.url.endsWith('/articles/wait')) { delayedContext = context; return waiting.promise; } } } });
  try {
    await e.boot(); e.window.history.pushState({}, '', '/articles/wait'); await delay(5);
    e.window.history.pushState({}, '', '/index'); e.window.history.pushState({}, '', '/articles/final'); await delay(35);
    assert(delayedContext.signal.aborted); assert.equal(delayedContext.isCurrent(), false);
    const before = e.fixture.trace.length; waiting.resolve(); await delay(10); assert.equal(e.fixture.trace.length, before);
    assert.equal(e.api.route.getRouteContext().generation, 4); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
    assert(!phases.some(url => url.endsWith('/index')));
  } finally { waiting.resolve(); await e.close(); }
});

test('superseded async feature enable honors original lifecycle signal and never mounts a stale result', async () => {
  const pending = deferred(); let captured;
  const e = await environment();
  e.fixture.enable = async (id, context) => { if (id === 'runtime-body' && context.routeGeneration === 1) { captured = context; await pending.promise; } };
  try {
    const startup = e.boot(); await delay(15); assert(captured);
    e.window.history.pushState({}, '', '/index'); await delay(5); assert(captured.signal.aborted);
    pending.resolve(); await startup; await delay(35);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 0);
    assert(!e.fixture.commits.includes('runtime-body:1'));
    await e.navigate('/articles/back'); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
  } finally { pending.resolve(); await e.close(); }
});

test('failed enable and disable remain diagnosable and healthy siblings/retry survive', async () => {
  const e = await environment(); let failEnable = true, failDisable = true;
  e.fixture.enable = id => { if (id === 'runtime-body' && failEnable) throw new Error('enable failed'); };
  e.fixture.disable = id => { if (id === 'runtime-body' && failDisable) throw new Error('disable failed'); };
  try {
    await e.boot(); assert.equal(e.api.health.getFeatureStatus('Runtime Body').status, 'failing'); assert.equal(e.api.health.getFeatureStatus('Runtime Fast').status, 'running');
    await e.navigate('/index'); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 0);
    failEnable = false; failDisable = false; await e.navigate('/articles/retry');
    assert.equal(e.api.health.getFeatureStatus('Runtime Body').status, 'running'); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
  } finally { await e.close(); }
});

test('BFCache suspends without duplicate mounts, resumes a forced generation and optional extension rejection does not block core', async () => {
  const e = await environment({ definition: { extensions: { refresh: async () => { throw new Error('policy unavailable'); } } } });
  try {
    await e.boot(); const first = e.api.route.getRouteContext();
    const hide = new e.window.Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: true }); e.window.dispatchEvent(hide);
    assert.equal(e.api.teardown.getRuntimeState(), 'suspended'); assert(first.signal.aborted); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
    const show = new e.window.Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); e.window.dispatchEvent(show); await delay(35);
    assert.equal(e.api.teardown.getRuntimeState(), 'running'); assert.equal(e.api.route.getRouteContext().generation, 2);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
    assert(e.api.health.getHealthEvents().some(event => event.message.includes('bfcache.extensions')));
  } finally { await e.close(); }
});

test('full teardown restores history and removes owned mounts, styles, observers, queues and pending callbacks; repeated teardown is inert', async () => {
  const e = await environment();
  try {
    await e.boot(); const patched = e.window.history.pushState;
    e.window.history.pushState({}, '', '/articles/pending');
    const summary = await e.api.teardown.teardownAll('fixture'); await delay(10);
    assert.equal(summary.state, 'stopped'); assert.notEqual(e.window.history.pushState, patched);
    assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 0);
    assert.equal(Object.keys(e.api.styles.getStyleRegistrySnapshot()).length, 0); assert.equal(e.api.resources.getResourceSnapshot().totalResources, 0);
    const before = e.fixture.trace.length; await e.api.teardown.teardownAll('again'); assert.equal(e.fixture.trace.length, before);
    e.window.history.pushState({}, '', '/articles/after-stop'); await delay(); assert.equal(e.fixture.trace.length, before);
    await e.boot(); assert.equal(e.window.document.querySelectorAll('[data-runtime-feature]').length, 2);
  } finally { await e.close(); }
});

test('pre-body teardown cancels original RAF readiness polling instead of leaking timers', async () => {
  const e = await environment({ body: false });
  try { const startup = e.boot(); await delay(10); assert(e.frames.size > 0); await e.api.teardown.teardownAll('pre-body'); await startup; assert.equal(e.frames.size, 0); assert(e.fixture.trace.every(entry => entry.startsWith('disable:'))); assert.equal(e.fixture.commits.length, 0); } finally { await e.close(); }
});

test('route callback synchronous throw/rejection enter diagnostics and disposal suppresses already queued callbacks', async () => {
  const e = await environment();
  try {
    await e.boot(); e.api.routeObserver.resetRouteObserverForTests();
    e.api.routeObserver.initRouteObserver(() => { throw new Error('sync route callback'); });
    await e.navigate('/articles/sync'); assert(e.api.health.getHealthEvents().some(event => event.message.includes('sync route callback')));
    e.api.routeObserver.resetRouteObserverForTests(); e.api.routeObserver.initRouteObserver(async () => { throw new Error('async route callback'); });
    await e.navigate('/articles/async'); assert(e.api.health.getHealthEvents().some(event => event.message.includes('async route callback')));
    e.api.routeObserver.resetRouteObserverForTests(); let called = 0; const dispose = e.api.routeObserver.initRouteObserver(() => called++);
    e.window.history.pushState({}, '', '/articles/queued'); dispose(); await delay(); assert.equal(called, 0);
  } finally { await e.close(); }
});

test('original matcher policies cover exact host, substring compatibility, query/hash, multiple flags and failing custom rules', async () => {
  const e = await environment();
  try {
    await e.boot(); const match = e.api.detection.matchesPageDefinition;
    const url = new URL('https://example.org/articles/one?q=1#result');
    for (const [rule, expected] of [
      [{ hostEquals: ['example.org'], pathStartsWith: ['/articles/'] }, true],
      [{ hostEquals: ['ample.org'] }, false], [{ hostIncludes: ['ample.org'] }, true],
      [{ hrefIncludes: ['?q=1'], pathPattern: ['^/articles/'] }, true], [{ hrefIncludes: ['#result'] }, true],
      [{ pathEquals: ['/articles/one'] }, true], [{ pathPattern: ['['] }, false],
      [{ match: location => location.search === '?q=1' }, true],
    ]) assert.equal(match(rule, url), expected);
    assert.throws(() => match({ match: () => { throw new Error('custom matcher'); } }, url), /custom matcher/);
    assert.equal(match({ hostEquals: ['example.org'] }, new URL('https://example.org.evil.test/articles/one')), false);
    const current = e.api.route.beginRoute(new URL('https://search.example.net/?q=test#results')); e.api.detection.detectPage(new URL(current.url), current);
    assert.equal(e.api.app.stateManager.get('isSearch'), true); assert.equal(e.api.app.stateManager.get('isArticle'), false);
    const old = e.api.route.beginRoute(url); e.api.route.beginRoute(new URL('https://example.org/index'));
    e.api.detection.detectPage(url, old); assert.equal(e.api.app.stateManager.get('isSearch'), true);
    assert.equal(e.api.scope.featureMatchesPageScopes({ pageScopes: [] }), true);
    assert.equal(e.api.scope.featureMatchesPageScopes({ pageScopes: ['isArticle', 'isSearch'] }), true);
  } finally { await e.close(); }
});

test('catalog keeps active-project scope validation, duplicate keys/settings and bootstrap declaration errors', async () => {
  const e = await environment();
  try {
    await e.boot(); const validate = e.api.catalog.validateFeatureDescriptor;
    assert.equal(validate({ id: 'independent', pageScopes: ['isArticle', 'isIndex'], bootstrapMode: 'fast' }).length, 0);
    assert(validate({ id: 'independent', pageScopes: ['isThread'] }).some(error => error.includes('unknown page scope')));
    assert(validate({ id: 'runtime-fast', featureKey: 'runtime-fast' }).some(error => error.includes('duplicate')));
    assert(validate({ id: 'new', bootstrapMode: 'immediate' }).some(error => error.includes('invalid bootstrap')));
    assert(validate({ id: 'new', settingsUi: { sectionId: 'articleTools', metaMaps: [{ 'runtime-fast': {} }] } }).some(error => error.includes('duplicate settings')));
  } finally { await e.close(); }
});

test('original deterministic manifest generation/check remains selected-project aware and stale checks never rewrite', () => {
  const project = loadProject({ rootDir: ROOT }); assert.equal(checkProjectFeatureManifest({ rootDir: ROOT }).matches, true);
  assert.equal(project.resolved.application, path.join(ROOT, 'projects/example/application.js'));
  const tmp = fs.mkdtempSync(path.join(ROOT, 'tests/.tmp-runtime-'));
  try {
    for (const name of ['zebra', 'article']) { const file = path.join(tmp, 'project/features', name, 'index.js'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `export const ${name}Feature = {};`); }
    const options = { rootDir: tmp, featuresDir: 'project/features', outputFile: 'project/generated/features.generated.js' };
    const first = buildFeatureManifestState(options); assert.deepEqual(first.featureNames, ['articleFeature', 'zebraFeature']); generateFeatureManifest(options);
    assert(checkFeatureManifest(options).matches); const file = path.join(tmp, options.outputFile); fs.writeFileSync(file, 'stale');
    assert.equal(checkFeatureManifest(options).matches, false); assert.equal(fs.readFileSync(file, 'utf8'), 'stale');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
