const { evidencePath } = require('./evidence-path.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { bundle, ROOT } = require('./runtime-helpers.cjs');

test('Chromium: original main/loader boots an example project, navigates, retries, suspends and fully cleans up', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [], consoleErrors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    await page.route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="content">Local article fixture</main>' }));
    await page.goto('https://example.org/articles/one');
    await page.evaluate(() => {
      globalThis.__nativeHistory = { pushState: history.pushState, replaceState: history.replaceState };
      globalThis.__runtimeFixture = { trace: [], clicks: [], commits: [], batches: [], settings: [], early: [], policy: [], enabled: true };
      globalThis.__runtimeInputs = {
        getConfig: () => ({ enabled: __runtimeFixture.enabled }),
        ensureReady: async () => ({ state: 'degraded-readonly', canWrite: false }),
        earlyWork: context => __runtimeFixture.early.push({ phase: context.phase, generation: context.generation, flags: context.pageFlags, current: context.isCurrent() }),
        settingsUi: { contributeToSection: (section, map, owner) => __runtimeFixture.settings.push({ section, keys: Object.keys(map), owner }) },
        extensions: { refresh: context => __runtimeFixture.policy.push(context.pageFlags) },
      };
    });
    await page.addScriptTag({ content: (await bundle()).code });
    await page.evaluate(() => __runtime.startRuntime());
    assert.equal(await page.locator('[data-runtime-feature]').count(), 2);
    assert.equal(await page.locator('[data-runtime-feature="runtime-body"]').evaluate(element => getComputedStyle(element).color), 'rgb(128, 0, 128)');
    await page.locator('[data-runtime-feature="runtime-body"]').click();
    await page.evaluate(() => history.pushState({}, '', '/articles/two'));
    await page.waitForFunction(() => __runtimeFixture.commits.includes('runtime-body:2'));
    assert.equal(await page.locator('[data-runtime-feature]').count(), 2);
    await page.evaluate(() => history.replaceState({}, '', '/index'));
    await page.waitForFunction(() => document.querySelectorAll('[data-runtime-feature]').length === 0);
    await page.goBack();
    await page.waitForFunction(() => document.querySelectorAll('[data-runtime-feature]').length === 2);
    await page.evaluate(() => { location.hash = 'section'; });
    await page.waitForFunction(() => __runtime.route.getRouteContext().generation === 5);
    await page.waitForFunction(() => __runtimeFixture.commits.includes('runtime-body:5'));
    await page.evaluate(async () => { __runtimeFixture.enabled = false; await __runtime.loader.reconcileFeatures(); });
    assert.equal(await page.locator('[data-runtime-feature]').count(), 0);
    await page.evaluate(async () => { __runtimeFixture.enabled = true; await __runtime.loader.reconcileFeatures(); });
    assert.equal(await page.locator('[data-runtime-feature]').count(), 2);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.equal(await page.evaluate(() => __runtime.teardown.getRuntimeState()), 'suspended');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await page.waitForFunction(() => __runtimeFixture.commits.includes('runtime-body:6'));
    assert.equal(await page.locator('[data-runtime-feature]').count(), 2);
    const evidence = await page.evaluate(async () => {
      const before = { generation: __runtime.route.getRouteContext().generation, mounts: document.querySelectorAll('[data-runtime-feature]').length,
        statuses: __runtime.health.getAllFeatureStatuses(), settings: __runtimeFixture.settings, early: __runtimeFixture.early,
        policy: __runtimeFixture.policy, clicks: __runtimeFixture.clicks, observerBatches: __runtimeFixture.batches.length };
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      const summary = await __runtime.teardown.teardownAll('browser verification');
      await new Promise(resolve => setTimeout(resolve, 20));
      const after = { state: __runtime.teardown.getRuntimeState(), mounts: document.querySelectorAll('[data-runtime-feature]').length,
        resources: __runtime.resources.getResourceSnapshot().totalResources, styles: Object.keys(__runtime.styles.getStyleRegistrySnapshot()).length,
        historyRestored: history.pushState === __nativeHistory.pushState && history.replaceState === __nativeHistory.replaceState };
      return { before, after, summary };
    });
    assert.deepEqual(evidence.after, { state: 'stopped', mounts: 0, resources: 0, styles: 0, historyRestored: true });
    assert.equal(evidence.before.settings.length, 2); assert(evidence.before.observerBatches > 0);
    assert.deepEqual(evidence.before.clicks, ['runtime-body']);
    assert(evidence.before.policy.some(flags => flags.isIndex)); assert.equal(evidence.summary.failures.length, 0);
    assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
    fs.writeFileSync(evidencePath('runtime/browser-evidence.json'), JSON.stringify({ checkedAt: new Date().toISOString(), browser: 'Chromium headless', managerInstalled: false, network: 'Locally intercepted example.org only', errors, consoleErrors, ...evidence }, null, 2) + '\n');
  } finally { await browser.close(); }
});
