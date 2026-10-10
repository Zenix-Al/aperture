const test = require('node:test');
const assert = require('node:assert/strict');
const { environment, manager, schema, plain } = require('./storage-helpers.cjs');
const boot = e => e.api.bootstrap.startStorageBootstrap();
const documentFor = e => plain(e.api.transfer.buildConfigExport());

test('independent tabs serialize fresh read-modify-write and reject stale whole candidates', async () => {
  const map = new Map(), first = await environment({ map }); await boot(first);
  const second = await environment({ map }); await boot(second);
  const stale = plain(second.api.state.config);
  const results = await Promise.all([
    first.api.settings.updateConfig(draft => { draft.count += 1; draft.preferences.title = 'first tab'; }),
    second.api.settings.updateConfig(draft => { draft.count += 1; draft.enabled = false; }),
  ]);
  assert(results.every(result => result.committed));
  const key = first.api.keys.CONFIG_STORAGE_KEYS.current;
  assert.equal(map.get(key).data.count, 4);
  assert.equal(map.get(key).data.preferences.title, 'first tab');
  assert.equal(map.get(key).data.enabled, false);
  await second.api.settings.updateConfig(draft => { draft.count = 10; });
  const writes = first.gm.operations.filter(([op]) => op === 'set').length;
  assert.equal((await first.api.settings.commitConfig(stale)).failed[0].code, 'config_stale_candidate');
  assert.equal((await first.api.settings.saveConfigKeys({ preferences: stale.preferences })).failed[0].code, 'config_stale_candidate');
  assert.equal(first.gm.operations.filter(([op]) => op === 'set').length, writes);
  assert.equal(map.get(key).data.count, 10);
});

test('insecure or lockless environments load read-only without canonical or backup mutation', async () => {
  const first = await environment(); await boot(first);
  for (const options of [{ secureContext: false }, { noLocks: true }]) {
    const e = await environment({ map: first.gm.map, ...options });
    const before = plain([...e.gm.map.entries()]);
    assert.equal((await boot(e)).state, 'degraded-readonly');
    assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 20; })).committed, false);
    assert.deepEqual(plain([...e.gm.map.entries()]), before);
    assert(!e.gm.operations.some(([op, key]) => op === 'set' && key === e.api.keys.CONFIG_STORAGE_KEYS.current));
  }
});

test('failed backup write-back retains recovered settings and exact backup without claiming commitment', async () => {
  const first = await environment(); await boot(first);
  await first.api.settings.updateConfig(draft => { draft.count = 19; });
  await first.api.settings.updateConfig(draft => { draft.count = 20; });
  const keys = first.api.keys.CONFIG_STORAGE_KEYS, backup = plain(first.gm.map.get(keys.backup));
  first.gm.map.set(keys.current, { broken: true });
  const e = await environment({ map: first.gm.map, hooks: { set: key => { if (key === keys.current) throw new Error('blocked'); } } });
  assert.equal((await boot(e)).state, 'degraded-readonly');
  assert.equal(e.api.state.config.count, 19);
  assert.equal((await e.api.settings.loadConfig()).persisted, false);
  assert.deepEqual(e.gm.map.get(keys.backup), backup);
  assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 21; })).committed, false);
});

test('cross-tab cache-only changes refresh inside the lock and stale cache snapshots cannot overwrite them', async () => {
  const definition = { schema: { ...schema, records: { type: 'array', defaultValue: [], items: { type: 'string', defaultValue: '' } } }, caches: { records: true } };
  const map = new Map(), first = await environment({ map, definition }); await boot(first);
  const second = await environment({ map, definition }); await boot(second);
  assert.equal((await first.api.settings.saveConfigKeys({ records: ['one'] })).committed, true);
  assert.equal((await second.api.settings.saveConfigKeys({ records: ['stale'] })).failed[0].code, 'config_stale_candidate');
  assert.equal((await second.api.settings.updateConfig(draft => { draft.records = [...draft.records, 'two']; }, { persistRuntimeCatalogs: ['records'] })).committed, true);
  assert.deepEqual(plain(map.get(first.api.keys.getCacheStorageKey('records'))), ['one', 'two']);
  const current = plain(map.get(first.api.keys.CONFIG_STORAGE_KEYS.current)); current.revision += 1; current.data.count = 'invalid'; map.set(first.api.keys.CONFIG_STORAGE_KEYS.current, current);
  assert.equal((await first.api.settings.updateConfig(draft => { draft.count = 8; })).failed[0].code, 'config_stale_canonical_invalid');
});

test('failed mixed cache/config commits roll back cache writes and never expose staged cache mutations', async () => {
  const definition = { schema: { ...schema, records: { type: 'array', defaultValue: [], items: { type: 'string', defaultValue: '' } } }, caches: { records: true } };
  const e = await environment({ definition }); await boot(e);
  await e.api.settings.saveConfigKeys({ records: ['kept'] });
  const keys = e.api.keys.CONFIG_STORAGE_KEYS, cacheKey = e.api.keys.getCacheStorageKey('records');
  e.gm.hooks.set = key => { if (key === keys.current) throw new Error('blocked'); };
  assert.equal((await e.api.settings.saveConfigKeys({ records: ['staged'], count: 3 })).committed, false);
  assert.deepEqual(plain(e.api.state.config.records), ['kept']); assert.deepEqual(e.gm.map.get(cacheKey), ['kept']); assert.equal(e.api.state.config.count, 2);
  assert.equal((await e.api.settings.updateConfig(draft => { draft.records.push('staged'); }, { persistRuntimeCatalogs: ['records'] })).committed, false);
  assert.deepEqual(plain(e.api.state.config.records), ['kept']); assert.deepEqual(e.gm.map.get(cacheKey), ['kept']);
});

test('staged add-on deltas and installation sightings merge into fresh state without losing another tab', async () => {
  const map = new Map(), first = await environment({ map }); await boot(first);
  const second = await environment({ map }); await boot(second);
  first.api.addonState.ensureAddonStateBucket('addon-one').bookmark = { path: '/one' };
  await second.api.addonState.setAddonStateValue('addon-two', 'theme', 'dark');
  await second.api.addonState.setAddonStateValue('addon-one', 'reminder', true);
  assert.equal((await first.api.addonState.persistAddonsState()).ok, true);
  const data = map.get(first.api.keys.CONFIG_STORAGE_KEYS.current).data;
  assert.equal(data.addons.byAddon['addon-one'].state.bookmark.path, '/one');
  assert.equal(data.addons.byAddon['addon-one'].state.reminder, true);
  assert.equal(data.addons.byAddon['addon-two'].state.theme, 'dark');
  await first.api.addonState.upsertInstalledAddonMeta('addon-one', { installedSeenAt: 100, lastSeenAt: 300 });
  await second.api.addonState.upsertInstalledAddonMeta('addon-one', { installedSeenAt: 200, lastSeenAt: 250 });
  const meta = map.get(first.api.keys.CONFIG_STORAGE_KEYS.current).data.addons.installedMeta['addon-one'];
  assert.equal(meta.installedSeenAt, 100); assert.equal(meta.lastSeenAt, 300);
});

test('partial config import preserves fresh sensitive and omitted fields from another tab', async () => {
  const map = new Map(), first = await environment({ map }); await boot(first);
  const second = await environment({ map }); await boot(second);
  const input = documentFor(first); input.settings = { preferences: { title: 'imported' } };
  await second.api.settings.updateConfig(draft => { draft.count = 18; draft.preferences.secret = 'fresh secret'; });
  assert.equal((await first.api.transfer.commitConfigImport(input)).ok, true);
  assert.equal(first.api.state.config.preferences.secret, 'fresh secret'); assert.equal(first.api.state.config.count, 18);
});

test('JSON file imports reject oversized and wrong-type files before reading and handle reader failure', async () => {
  const e = await environment(); let reads = 0;
  const file = { name: 'settings.json', type: 'application/json', size: 5 * 1024 * 1024 + 1, text: async () => { reads++; return '{}'; } };
  assert.equal((await e.api.transferIO.readJsonImportFile(file)).ok, false); assert.equal(reads, 0);
  assert.equal((await e.api.transferIO.readJsonImportFile({ ...file, name: 'a.txt', type: 'text/plain', size: 2 })).ok, false); assert.equal(reads, 0);
  assert.equal((await e.api.transferIO.readJsonImportFile({ ...file, size: 2 })).text, '{}');
  assert.match((await e.api.transferIO.readJsonImportFile({ ...file, size: 2, text: async () => { throw new Error('private details'); } })).message, /could not read/);
});

test('picker cancellation releases focus timers; delayed selections and download URLs retain their lifetime', async () => {
  const e = await environment(), { Window } = require('happy-dom');
  const window = new Window({ url: 'https://example.org/' }), clock = require('./helpers.cjs').createFakeClock();
  const revoked = []; let sequence = 0;
  Object.assign(e.sandbox, { window, document: window.document, Blob, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
    URL: { createObjectURL: () => `blob:fixture-${++sequence}`, revokeObjectURL: url => revoked.push(url) } });
  try {
    const picker = e.api.transferIO.createJsonFilePicker(), input = window.document.querySelector('input');
    window.dispatchEvent(new window.Event('focus')); await clock.tick(350);
    assert(input.isConnected);
    const file = { name: 'chosen.json' }; Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new window.Event('change'));
    assert.equal(await picker.promise, file); assert.equal(clock.pending(), 0);
    const cancelled = e.api.transferIO.createJsonFilePicker();
    window.dispatchEvent(new window.Event('focus'));
    window.document.querySelector('input').dispatchEvent(new window.Event('cancel'));
    assert.equal(await cancelled.promise, null); assert.equal(clock.pending(), 0);
    const first = e.api.transferIO.downloadJsonFile('first.json', '{}');
    const second = e.api.transferIO.downloadJsonFile('second.json', '{}');
    await clock.tick(9999); assert.deepEqual(revoked, []);
    first(); first(); assert.deepEqual(revoked, ['blob:fixture-1']);
    await clock.tick(1); assert.deepEqual(revoked, ['blob:fixture-1', 'blob:fixture-2']);
    second(); assert.equal(clock.pending(), 0);
  } finally { await window.close(); }
});

test('IndexedDB completion observed before callback resolution still settles successfully', async () => {
  const e = await environment();
  const db = { close() {}, transaction() {
    const tx = { abort() {}, objectStore() { return { get() {
      const request = {};
      queueMicrotask(() => { tx.oncomplete(); request.result = 'retained result'; request.onsuccess(); });
      return request;
    } }; } };
    return tx;
  } };
  e.sandbox.indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } };
  const value = await Promise.race([
    e.api.idb.idbGetForAddon('addon-one', { key: 'one' }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('transaction completion was missed')), 1000); timer.unref(); }),
  ]);
  assert.equal(value, 'retained result');
  e.api.idb.resetAddonDatabaseCacheForTests();
});

test('generic schema keeps original strict/tolerant validation and path metadata without product fields', async () => {
  const e = await environment(), api = e.api.schema;
  assert.equal(api.validateConfig(api.getDefaultConfig(), { mode: 'strict' }).valid, true);
  assert.equal(api.validateConfig({ count: 0, invented: true }, { mode: 'strict' }).valid, false);
  const sanitized = api.sanitizeConfig({ count: 'bad', enabled: false, preferences: { title: 'kept' } });
  assert.equal(sanitized.data.enabled, false); assert.equal(sanitized.data.preferences.title, 'kept'); assert.equal(sanitized.data.count, 2);
  assert.equal(api.getConfigPathMetadata('preferences.secret').sensitive, true);
  assert.equal(api.getConfigPathMetadata('count').reloadRequired, true); assert.equal(api.getConfigPathMetadata('invented'), null);
  assert(!Object.hasOwn(api.getDefaultConfig(), 'tags'));
});

test('fresh install is schema one, verified once, uses only project keys, and reload is canonical-write-free', async () => {
  const e = await environment(); assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 3; })).committed, false);
  assert.equal(e.gm.operations.length, 0);
  assert.equal((await boot(e)).state, 'ready');
  const keys = e.api.keys.CONFIG_STORAGE_KEYS, envelope = e.gm.map.get(keys.current);
  assert.equal(envelope.schemaVersion, 1); assert.equal(envelope.revision, 1);
  assert.equal(e.api.keys.CONFIG_MIGRATION_COUNT, 0);
  assert(e.gm.operations.every(([, key]) => key.startsWith(`aperture:aperture-example:aperture_example:`)));
  assert(![...e.gm.map.keys()].some(key => key.includes('probe:')));
  const again = await environment({ map: e.gm.map }); await boot(again);
  assert(!again.gm.operations.some(([op, key]) => op === 'set' && key === keys.current));
});

test('two project IDs and explicit namespaces isolate all keys and leave earlier data intact', async () => {
  const map = new Map([['aperture:foreign-project:foreign_namespace:config', { untouched: true }]]);
  const first = await environment({ map }); await boot(first); await first.api.settings.updateConfig(draft => { draft.count = 7; });
  const second = await environment({ map, id: 'other' }); await boot(second);
  const third = await environment({ map, namespace: 'next' }); await boot(third);
  assert.equal(first.api.state.config.count, 7); assert.equal(second.api.state.config.count, 2); assert.equal(third.api.state.config.count, 2);
  const cosmetic = await environment({ map, displayName: 'Renamed project' }); await boot(cosmetic);
  assert.equal(cosmetic.api.state.config.count, 7); assert.deepEqual(plain(cosmetic.api.keys.CONFIG_STORAGE_KEYS), plain(first.api.keys.CONFIG_STORAGE_KEYS));
  assert.deepEqual(map.get('aperture:foreign-project:foreign_namespace:config'), { untouched: true });
  for (const name of Object.keys(first.api.keys.CONFIG_STORAGE_KEYS)) assert.notEqual(first.api.keys.CONFIG_STORAGE_KEYS[name], second.api.keys.CONFIG_STORAGE_KEYS[name]);
  assert.notEqual(first.api.keys.getAddonStorageKey('addon-one', 'pref'), second.api.keys.getAddonStorageKey('addon-one', 'pref'));
  assert.notEqual(first.api.keys.getAddonDatabaseName('addon-one', 'library'), third.api.keys.getAddonDatabaseName('addon-one', 'library'));
  assert.throws(() => first.api.keys.getAddonStorageKey('../bad', 'pref'));
});

test('normal commits serialize revisions, back up prior envelope, and do not apply rejected or mismatched writes', async () => {
  const e = await environment(); await boot(e);
  const results = await Promise.all([3, 4, 5].map(count => e.api.settings.updateConfig(draft => { draft.count = count; })));
  assert(results.every(result => result.committed)); assert.deepEqual(results.map(result => result.revision), [2, 3, 4]);
  const keys = e.api.keys.CONFIG_STORAGE_KEYS; assert.equal(e.gm.map.get(keys.backup).data.count, 4);
  e.gm.hooks.set = async key => key === keys.current ? { handled: true, value: false } : undefined;
  assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 6; })).committed, false); assert.equal(e.api.state.config.count, 5);
  e.gm.hooks.set = async key => key === keys.current ? { handled: true, value: undefined } : undefined;
  assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 8; })).committed, false); assert.equal(e.api.state.config.count, 5);
});

test('corrupt canonical recovers valid backup; corrupt both remains read-only and blocks core-mediated add-on writes', async () => {
  const e = await environment(); await boot(e); await e.api.settings.updateConfig(draft => { draft.count = 9; });
  const keys = e.api.keys.CONFIG_STORAGE_KEYS; e.gm.map.set(keys.current, { broken: true });
  const recovered = await environment({ map: e.gm.map }); assert.equal((await boot(recovered)).state, 'ready'); assert.equal(recovered.api.state.config.count, 2);
  e.gm.map.set(keys.current, { broken: true }); e.gm.map.set(keys.backup, { broken: true });
  const degraded = await environment({ map: e.gm.map }); assert.equal((await boot(degraded)).state, 'degraded-readonly');
  const bucket = {}; const result = await degraded.api.addonStorage.actionStorageSet('addon-one', { key: 'preference', value: 42 }, value => JSON.stringify(value).length, 1000, 2000, () => bucket,
    async () => { const access = await degraded.api.readiness.waitForStorageWriteAccess(); return access.ok ? { ok: true } : { ok: false, reason: access.reason }; });
  assert.equal(result.ok, false); assert.deepEqual(bucket, {});
  assert.equal(await degraded.api.prefs.persistSettingsUiValue(keys.activePanel, 'test'), false);
});

test('unsupported future schema is preserved read-only; invalid migration chains fail before access', async () => {
  const e = await environment(); await boot(e); const key = e.api.keys.CONFIG_STORAGE_KEYS.current;
  const future = { ...plain(e.gm.map.get(key)), schemaVersion: 9 }; e.gm.map.set(key, future);
  const other = await environment({ map: e.gm.map }); assert.equal((await boot(other)).state, 'degraded-readonly'); assert.deepEqual(other.gm.map.get(key), future);
  for (const definition of [{ schema, schemaVersion: 2, migrations: [] }, { schema, schemaVersion: 2, migrations: [{ fromVersion: 1, toVersion: 3, migrate: value => value }] }]) await assert.rejects(environment({ definition }), /migration registry/);
});

test('synthetic project migration keeps exact backup and retries interrupted canonical write', async () => {
  const initial = await environment(); await boot(initial); const keys = initial.api.keys.CONFIG_STORAGE_KEYS, original = plain(initial.gm.map.get(keys.current));
  const definition = { schema, schemaVersion: 2, migrations: [{ fromVersion: 1, toVersion: 2, migrate: data => ({ ...data, count: 11 }) }] };
  let fail = true;
  const e = await environment({ map: initial.gm.map, definition, hooks: { set: async key => { if (key === keys.current && fail) throw new Error('interrupted'); } } });
  assert.equal((await boot(e)).state, 'degraded-readonly'); assert.deepEqual(e.gm.map.get(keys.current), original);
  fail = false; assert.equal((await e.api.bootstrap.retryStorageBootstrap()).state, 'ready');
  assert.equal(e.gm.map.get(keys.current).schemaVersion, 2); assert.equal(e.api.state.config.count, 11); assert.deepEqual(e.gm.map.get(keys.backup), original);
});

test('missing APIs, rejected probe, readback and cleanup failure remain unavailable and diagnostic reasons omit secrets', async () => {
  const missing = await environment({ missingGM: true }); await assert.rejects(boot(missing)); assert.equal(missing.api.readiness.getStorageReadinessSnapshot().state, 'unavailable');
  for (const hooks of [
    { set: async () => { throw new Error('private-token nonce-secret aperture:foreign-project:foreign_namespace:config'); } },
    { get: async key => key.includes('probe:') ? { handled: true, value: null } : undefined },
    { delete: async () => ({ handled: true, value: false }) },
  ]) {
    const e = await environment({ hooks }); await assert.rejects(boot(e));
    const diagnostics = JSON.stringify(e.api.readiness.getStorageReadinessSnapshot()) + JSON.stringify(e.api.health.getHealthEvents());
    assert(!/private-token|nonce-secret|aperture:foreign-project:foreign_namespace:config/.test(diagnostics)); assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 12; })).committed, false);
  }
});

test('transfer excludes sensitive fields, previews partial changes, commits safely and rejects foreign or historical documents', async () => {
  const e = await environment(); await boot(e); await e.api.settings.updateConfig(draft => { draft.preferences.secret = 'changed-secret'; }); const document = documentFor(e);
  assert.equal(document.projectId, 'aperture-example'); assert.equal(document.storageNamespace, 'aperture_example');
  assert.equal(document.settings.preferences.secret, undefined); assert.equal(document.settings.addons, undefined);
  document.settings.count = 12; document.settings.preferences.title = 'imported';
  const preview = e.api.transfer.previewConfigImport(document); assert.equal(preview.ok, true); assert.equal(preview.reloadRequired, true);
  assert.equal((await e.api.transfer.commitConfigImport(document)).ok, true); assert.equal(e.api.state.config.preferences.secret, 'changed-secret');
  for (const input of [{ ...document, projectId: 'other' }, { ...document, storageNamespace: 'other' }, { ...document, schemaVersion: 0 }, { settings: { minVersion: 2 } }, { ...document, settings: { preferences: { secret: 'overwrite' } } }]) assert.equal(e.api.transfer.previewConfigImport(input).ok, false);
  e.gm.hooks.set = async key => key === e.api.keys.CONFIG_STORAGE_KEYS.current ? { handled: true, value: false } : undefined;
  document.settings.count = 15; assert.equal((await e.api.transfer.commitConfigImport(document)).ok, false); assert.equal(e.api.state.config.count, 12);
});

test('UI and add-on storage share original gate; successful preference survives reload separately', async () => {
  const e = await environment(), keys = e.api.keys.CONFIG_STORAGE_KEYS;
  assert.equal(await e.api.prefs.persistSettingsUiValue(keys.activePanel, 'preferences'), false);
  await boot(e); assert.equal(await e.api.prefs.persistSettingsUiValue(keys.activePanel, 'preferences'), true);
  const bucket = () => { e.api.state.config.addons.byAddon['addon-one'] ??= { state: {} }; return e.api.state.config.addons.byAddon['addon-one'].state; };
  const result = await e.api.addonStorage.actionStorageSet('addon-one', { key: 'preference', value: 42 }, value => JSON.stringify(value).length, 1000, 2000, bucket,
    async () => ({ ok: (await e.api.settings.saveConfigKeys({ addons: e.api.state.config.addons })).committed }));
  assert.equal(result.ok, true);
  const reload = await environment({ map: e.gm.map }); await boot(reload); assert.equal(reload.api.state.config.addons.byAddon['addon-one'].state.preference, 42);
  assert.equal(reload.gm.map.get(keys.activePanel), 'preferences');
  await reload.api.prefs.ensureSettingsUiPrefsLoaded(); assert.equal(reload.api.state.stateManager.get('settingsActivePanel'), 'preferences'); assert.equal(reload.api.state.stateManager.get('settingsUiPrefsLoaded'), true);
});

test('concurrent original bootstrap owners settle one fresh envelope; expired initialization locks are replaceable', async () => {
  const gm = manager(); const first = await environment({ gm }), second = await environment({ gm });
  const snapshots = await Promise.all([boot(first), boot(second)]); assert(snapshots.every(snapshot => snapshot.state === 'ready'));
  const keys = first.api.keys.CONFIG_STORAGE_KEYS;
  assert.equal(gm.operations.filter(([op, key]) => op === 'set' && key === keys.current).length, 1);
  const stale = manager(new Map([[keys.initializationLock, { owner: 'expired', expiresAt: 1 }]]));
  const e = await environment({ gm: stale }); assert.equal((await boot(e)).state, 'ready'); assert.equal(stale.map.has(keys.initializationLock), false);
});

test('explicit retry repairs a missing capability, and false writes after mutation still clean up the owned probe', async () => {
  const gm = manager(), deleteValue = gm.api.deleteValue; gm.api.deleteValue = undefined;
  const e = await environment({ gm }); await assert.rejects(boot(e)); gm.api.deleteValue = deleteValue;
  assert.equal((await e.api.bootstrap.retryStorageBootstrap()).state, 'ready');
  const leaky = manager(undefined, { set: async (key, value, map) => { map.set(key, value); return { handled: true, value: false }; } });
  const probe = await e.api.storage.probeStorageCapabilities(leaky.api, { probeId: 'false-write' }); assert.equal(probe.ok, false);
  assert.equal(leaky.map.size, 0); assert.equal(probe.reason, 'write_returned_false');
});

test('backup readback failure stops canonical commit before applying live state or effects', async () => {
  const e = await environment(); await boot(e); const keys = e.api.keys.CONFIG_STORAGE_KEYS, canonical = plain(e.gm.map.get(keys.current));
  e.gm.hooks.set = async key => key === keys.backup ? { handled: true, value: undefined } : undefined;
  assert.equal((await e.api.settings.updateConfig(draft => { draft.count = 33; })).committed, false);
  assert.equal(e.api.state.config.count, 2); assert.deepEqual(e.gm.map.get(keys.current), canonical);
});

test('selected cache sections keep original catalog projection and reference bypass without requiring tags or prefixes', async () => {
  const definition = { schema: { ...schema, records: { type: 'array', defaultValue: [], items: { type: 'string', defaultValue: '' } } }, caches: { records: true } };
  const e = await environment({ definition }); await boot(e);
  assert.equal((await e.api.settings.saveConfigKeys({ records: ['one', 'two'] })).committed, true);
  const records = e.api.state.config.records; await e.api.settings.updateConfig(draft => { draft.count = 4; });
  assert.equal(e.api.state.config.records, records); assert.deepEqual(e.gm.map.get(e.api.keys.CONFIG_STORAGE_KEYS.current).data.records, []);
  const reload = await environment({ definition, map: e.gm.map }); await boot(reload); assert.deepEqual(plain(reload.api.state.config.records), ['one', 'two']);
});

test('original effect batching and failure isolation work with project metadata providers', async () => {
  const calls = [];
  const definition = { schema, effects: {
    getMetadataByConfigPath(path) { if (path === 'enabled') throw new Error('optional metadata failed'); return { id: 'shared-effect' }; },
    applyEffects(meta, value, context) { calls.push({ meta, value, context }); return Promise.reject(new Error('optional effect failed')); },
  } };
  const e = await environment({ definition }); await boot(e); calls.length = 0;
  const result = await e.api.settings.updateConfig(draft => { draft.enabled = false; draft.count = 4; draft.preferences.title = 'effect'; });
  assert.equal(result.committed, true); assert.equal(calls.length, 1); assert.equal(calls[0].context.origin, 'local');
  assert(e.api.health.getHealthEvents().some(entry => entry.ownerId === 'Config'));
});

test('unsafe schema/object/add-on keys fail closed, and arrays with protected descendants cannot discard secrets through transfer', async () => {
  await assert.rejects(environment({ definition: { schema: { bad: { type: 'invented', defaultValue: true } } } }), /descriptor/);
  await assert.rejects(environment({ definition: { schema: JSON.parse('{"__proto__":{"type":"any","defaultValue":{}}}') } }), /schema path/);
  const e = await environment();
  assert.equal(e.api.schema.validateConfig({ addons: { byAddon: JSON.parse('{"__proto__":{"polluted":true}}') } }, { mode: 'strict' }).valid, false);
  const result = await e.api.addonStorage.actionStorageSet('addon-one', { key: '__proto__', value: {} }, () => 1, 100, 100, () => ({}), async () => ({ ok: true })); assert.equal(result.ok, false);
  const descriptor = { type: 'array', defaultValue: [], exportable: true, items: { type: 'object', defaultValue: {}, properties: { token: { type: 'string', defaultValue: '', sensitive: true } } } };
  const protectedArray = await environment({ definition: { schema: { ...schema, credentials: descriptor } } }); await boot(protectedArray);
  const document = documentFor(protectedArray); assert.equal(document.settings.credentials, undefined);
  document.settings.credentials = [{ token: 'do-not-replace' }]; assert.equal(protectedArray.api.transfer.previewConfigImport(document).ok, false);
});

test('every core-mediated IDB action uses the sole readiness gate, including schema-opening reads', async () => {
  const e = await environment(); let calls = 0;
  const context = { addonId: 'addon-one', payload: { key: 'one', value: 1, entries: [], keys: [] }, limits: { maxAddonIdbPayloadBytes: 1000, maxAddonIdbBulkItems: 100 }, deps: {
    measurePayloadBytes: () => 1,
    ...Object.fromEntries(['idbGetForAddon', 'idbPutForAddon', 'idbDeleteForAddon', 'idbBulkPutForAddon', 'idbBulkDeleteForAddon', 'idbQueryForAddon', 'idbCountForAddon'].map(name => [name, async () => { calls++; return 1; }])),
  } };
  for (const descriptor of e.api.idbActions.idbActions) assert.equal((await descriptor.execute(context)).reason, 'storage_not_ready');
  assert.equal(calls, 0); await boot(e);
  for (const descriptor of e.api.idbActions.idbActions) assert.equal((await descriptor.execute(context)).ok, true);
  assert.equal(calls, 7);
});

test('project migrations receive raw prior-schema fields before current-schema sanitization and retain exact backup', async () => {
  const old = await environment({ definition: { schema: { oldName: { type: 'string', defaultValue: 'saved-value', exportable: true } } } }); await boot(old);
  const keys = old.api.keys.CONFIG_STORAGE_KEYS, prior = plain(old.gm.map.get(keys.current));
  const next = await environment({ map: old.gm.map, definition: { schema: { newName: { type: 'string', defaultValue: 'default', exportable: true } }, schemaVersion: 2, migrations: [{ fromVersion: 1, toVersion: 2, migrate: data => ({ newName: data.oldName }) }] } });
  assert.equal((await boot(next)).state, 'ready'); assert.equal(next.api.state.config.newName, 'saved-value'); assert.deepEqual(next.gm.map.get(keys.backup), prior);
});


test('core settings exist without project declarations, export visibility, and reject project overrides', async () => {
  const e = await environment({definition:{schema:{}}}), defaults=plain(e.api.schema.getDefaultConfig());
  assert.equal(defaults.globalSettings.configVisibility,true);
  assert.equal(defaults.addons.service.disabled,false);
  assert.deepEqual(defaults.addons.service.apiThrottle,{coreActionWindowMs:5000,coreActionRateMax:100,coreActionMaxConcurrent:12});
  assert.equal(e.api.schema.getConfigPathMetadata('globalSettings.configVisibility').exportable,true);
  assert.equal(e.api.schema.validateConfig({...defaults,globalSettings:{configVisibility:'yes'}},{mode:'strict'}).valid,false);
  await assert.rejects(environment({definition:{schema:{globalSettings:{type:'boolean',defaultValue:true}}}}),/owned by core/);
  await assert.rejects(environment({definition:{schema:{addons:{type:'object',defaultValue:{}}}}}),/owned by core/);
});
