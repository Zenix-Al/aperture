const { evidencePath } = require('./evidence-path.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ROOT, bundle } = require('./storage-helpers.cjs');

test('Chromium Web Locks coordinate concurrent settings writes from two independent same-origin tabs', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Cross-tab settings</main>' }));
    await context.addInitScript(() => { globalThis.GM = {
      info: { scriptHandler: 'browser regression fixture' },
      getValue: async (key, fallback) => { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); },
      setValue: async (key, value) => localStorage.setItem(key, JSON.stringify(value)), deleteValue: async key => localStorage.removeItem(key),
    }; });
    const pages = [await context.newPage(), await context.newPage()], code = (await bundle({ sample: true })).outputFiles[0].text;
    for (const page of pages) { await page.goto('https://example.org/articles/concurrent'); await page.addScriptTag({ content: code }); await page.evaluate(() => __storage.bootstrap.startStorageBootstrap()); }
    const results = await Promise.all(pages.map((page, index) => page.evaluate(index => __storage.settings.updateConfig(draft => {
      draft.preferences.pageSize += 1;
      if (index === 0) draft.exampleEnabled = false;
      else draft.preferences.token = 'fresh';
    }), index)));
    assert(results.every(result => result.committed));
    const data = await pages[0].evaluate(() => JSON.parse(localStorage.getItem(__storage.keys.CONFIG_STORAGE_KEYS.current)).data);
    assert.equal(data.preferences.pageSize, 22); assert.equal(data.exampleEnabled, false); assert.equal(data.preferences.token, 'fresh');
  } finally { await browser.close(); }
});

test('Chromium IndexedDB aborts failed bulk callbacks and never leaves a partial write', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<main>IDB regression</main>' }));
    await page.goto('https://example.org/articles/idb');
    await page.addScriptTag({ content: (await bundle({ sample: true })).outputFiles[0].text });
    const result = await page.evaluate(async () => {
      let failed = false;
      try {
        await __storage.idb.idbBulkPutForAddon('addon-one', { dbName: 'rollback', entries: [
          { value: { id: 'first', value: 'must roll back' } }, { value: { id: 'second', uncloneable: () => {} } },
        ] });
      } catch { failed = true; }
      const first = await __storage.idb.idbGetForAddon('addon-one', { dbName: 'rollback', key: 'first' });
      let synchronousFailure = false;
      try { await __storage.idb.idbPutForAddon('addon-one', { dbName: 'rollback', value: {} }); } catch { synchronousFailure = true; }
      return { failed, absent: first === undefined, synchronousFailure, count: await __storage.idb.idbCountForAddon('addon-one', { dbName: 'rollback' }) };
    });
    assert.deepEqual(result, { failed: true, absent: true, synchronousFailure: true, count: 0 });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Chromium sample boots original main, persists across reloads, transfers safely, isolates namespace and fails closed without GM', async () => {
  const browser = await chromium.launch({ headless: true });
  const evidence = { managerInstalled: false, browser: 'Chromium headless', storageBackend: 'GM stand-in backed by origin localStorage; disposable intercepted example.org', checks: [] };
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://example.org/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Disposable Aperture storage example</main>' }));
    await page.addInitScript(() => {
      globalThis.GM = {
        info: { scriptHandler: 'Chromium test stand-in' },
        getValue: async (key, fallback) => { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); },
        setValue: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
        deleteValue: async key => localStorage.removeItem(key),
      };
    });
    const build = await bundle({ main: true, sample: true });
    await page.goto('https://example.org/articles/one');
    await page.addScriptTag({ content: build.outputFiles[0].text });
    const first = await page.evaluate(async () => {
      await __storage.main.startRuntime();
      const initial = __storage.readiness.getStorageReadinessSnapshot();
      const changed = await __storage.settings.updateConfig(draft => { draft.exampleEnabled = false; draft.preferences.pageSize = 37; draft.preferences.token = 'never-export'; });
      await __storage.prefs.persistSettingsUiValue(__storage.keys.CONFIG_STORAGE_KEYS.pinnedAddons, ['example-addon']);
      const addonWrite = await __storage.idbActions.actionIdbPut('example-addon', { dbName: 'preferences', storeName: 'records', key: 'theme', value: { id: 'theme', value: 'dark' } }, value => JSON.stringify(value).length, 10000, __storage.idb.idbPutForAddon);
      const exported = __storage.transfer.buildConfigExport();
      return { initial, changed: changed.committed, addonWrite, exported, keys: Object.keys(localStorage) };
    });
    assert.equal(first.initial.state, 'ready'); assert.equal(first.changed, true); assert.equal(first.addonWrite.ok, true, JSON.stringify(first.addonWrite));
    assert.equal(first.exported.settings.preferences.token, undefined); assert(first.keys.every(key => key.startsWith('aperture:aperture-example:aperture_example:')));
    await page.reload(); await page.addScriptTag({ content: build.outputFiles[0].text });
    const reload = await page.evaluate(async () => {
      await __storage.main.startRuntime();
      const persisted = JSON.parse(JSON.stringify(__storage.state.config));
      const addonRead = await __storage.idbActions.actionIdbGet('example-addon', { dbName: 'preferences', storeName: 'records', key: 'theme' }, value => JSON.stringify(value).length, 10000, __storage.idb.idbGetForAddon);
      const pins = await GM.getValue(__storage.keys.CONFIG_STORAGE_KEYS.pinnedAddons, []);
      const document = __storage.transfer.buildConfigExport(); document.settings.preferences.pageSize = 25;
      const imported = await __storage.transfer.commitConfigImport(document);
      return { persisted, pins, addonPreference: addonRead.value?.value, imported: imported.ok, pageSize: __storage.state.config.preferences.pageSize, secret: __storage.state.config.preferences.token };
    });
    assert.equal(reload.addonPreference, 'dark'); assert.equal(reload.persisted.exampleEnabled, false); assert.equal(reload.persisted.preferences.pageSize, 37); assert.deepEqual(reload.pins, ['example-addon']); assert.equal(reload.imported, true); assert.equal(reload.pageSize, 25); assert.equal(reload.secret, "never-export");
    await page.reload(); const isolated = await bundle({ main: true, sample: true, namespace: 'isolated' }); await page.addScriptTag({ content: isolated.outputFiles[0].text });
    const isolation = await page.evaluate(async () => { await __storage.main.startRuntime(); return { pageSize: __storage.state.config.preferences.pageSize, old: JSON.parse(localStorage.getItem('aperture:aperture-example:aperture_example:config')).data.preferences.pageSize }; });
    assert.deepEqual(isolation, { pageSize: 20, old: 25 });
    await page.reload(); await page.evaluate(() => { globalThis.GM = undefined; }); await page.addScriptTag({ content: build.outputFiles[0].text });
    const unavailable = await page.evaluate(async () => { await __storage.main.startRuntime(); const result = await __storage.settings.updateConfig(draft => { draft.exampleEnabled = true; }); return { state: __storage.readiness.getStorageReadinessSnapshot().state, committed: result.committed }; });
    assert.deepEqual(unavailable, { state: 'unavailable', committed: false }); assert.deepEqual(errors, []);
    evidence.checks = ['actual sample/main fresh schema-v1 install', 'changed settings, separate pinned add-on UI preference, and original IDB add-on action preference survive reload', 'sensitive field excluded from transfer', 'preview/commit round-trip preserves secret', 'explicit namespace isolation leaves prior data intact', 'missing GM fails closed']; evidence.errors = errors;
    evidence.unverified = ['real userscript manager installation/reload/grant behavior', 'full add-on runtime/catalog/IDB browser integration assigned to phase 5'];
    fs.writeFileSync(evidencePath('storage/browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  } finally { await browser.close(); }
});
