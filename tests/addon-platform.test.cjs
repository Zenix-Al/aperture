const test = require('node:test');
const assert = require('node:assert/strict');
const { environment, bundle, descriptor } = require('./addon-platform-helpers.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

test('selected platform keeps 29 generic descriptors and excludes product modules', async () => {
  const e = await environment();
  try {
    assert.equal(e.ping.ok, true);
    assert.equal(e.api.actions.PUBLIC_ACTION_IDS.length, 29);
    assert(!e.api.actions.PUBLIC_ACTION_IDS.includes('config.getTagPrefs'));
    assert(!Object.keys(e.built.metafile.inputs).some(file => /latestMarker|families\/latestMarkers|trusted-addon-aliases\.json/.test(file)));
    assert.equal(e.api.catalog.listTrustedAddonCatalog().length, 1);
    assert.equal(e.api.bridge.getAddonsBridgeDiagnostics().listenerBound, true);
  } finally { await e.close(); }
});

test('original client handshake, registration, storage, page context and disable/re-enable work together', async () => {
  const e = await environment();
  try {
    e.register();
    assert.equal((await e.client.getAddonAccess()).value.trusted, true);
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'test', value: { answer: 42 } })).ok, true);
    assert.deepEqual(plain((await e.client.invokeCoreAction('storage.get', { key: 'test' })).value), { answer: 42 });
    const context = (await e.client.invokeCoreAction('page.getContext')).value;
    assert.deepEqual(plain(context.pageScopes), ['example']);
    assert(!Object.hasOwn(context, 'threadId'));
    assert.equal((await e.client.invokeCoreAction('feature.disable')).ok, true);
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'test', value: 0 })).reason, 'addon_disabled');
    assert.equal((await e.client.invokeCoreAction('feature.enable')).ok, true);
    assert.equal((await e.client.invokeCoreAction('storage.get', { key: 'test' })).ok, true);
    assert(e.gm.operations.every(([, key]) => key.startsWith('aperture:aperture-example:aperture_example:')));
  } finally { await e.close(); }
});

for (const [label, overrides] of Object.entries({
  'unknown capability': { capabilities: ['invented'] },
  'capability escalation': { capabilities: [...descriptor.capabilities, 'routing'] },
  'version mismatch': { version: '99.0.0' },
  'broader match': { matches: ['http://*/*'] },
  'foreign scope': { pageScopes: ['thread'] },
})) test('registration fails closed for ' + label, async () => {
  const e = await environment();
  try {
    e.register(overrides);
    const result = await e.client.invokeCoreAction('storage.set', { key: 'denied', value: true });
    assert.equal(result.ok, false);
    assert(!e.api.state.config.addons.byAddon['example-addon']?.state?.denied);
  } finally { await e.close(); }
});

test('empty project catalog and persisted trust IDs cannot authorize a privileged write', async () => {
  const e = await environment({ policy: { catalog: [] } });
  try {
    e.api.state.config.addons.trustedIds = ['example-addon']; e.register();
    assert.equal((await e.client.getAddonAccess()).value.blocked, true);
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'x', value: true })).ok, false);
  } finally { await e.close(); }
});

test('original payload bounds, cleanup and deterministic unknown action rejection remain enforced', async () => {
  const e = await environment();
  try {
    e.register();
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'x', value: 'x'.repeat(17000) })).reason, 'payload_too_large');
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: '__proto__', value: {} })).ok, false);
    assert.equal((await e.client.invokeCoreAction('invented.action')).ok, false);
    assert.equal((await e.client.invokeCoreAction('ui.mount', { mountId: 'test', html: '<div>Owned</div>' })).ok, true);
    assert.equal((await e.client.invokeCoreAction('feature.disable')).ok, true);
    assert.equal(Object.values(e.api.ui.getAddonUiPolicySnapshot().owners).flat().length, 0);
  } finally { await e.close(); }
});

test('wire envelopes reject foreign project, stale instance, version and replay', async () => {
  const e = await environment();
  try {
    const api = e.api, base = { marker: api.contract.ADDONS_DEV_BRIDGE_MARKER, protocolVersion: '0.1.0', projectId: api.contract.ADDON_PROJECT_ID, instanceId: api.bridge.ADDON_INSTANCE_ID, requestId: 'request-123', addonId: 'example-addon', action: 'storage.get', payload: {} };
    const options = { marker: base.marker, apiVersion: '0.1.0', instanceId: base.instanceId };
    assert.equal(api.protocol.validateAddonRequestEnvelope(base, options).ok, true);
    assert.equal(api.protocol.validateAddonRequestEnvelope({ ...base, projectId: 'other' }, options).reason, 'wrong_project');
    assert.equal(api.protocol.validateAddonRequestEnvelope({ ...base, instanceId: 'old' }, options).reason, 'wrong_instance');
    assert.equal(api.protocol.validateAddonRequestEnvelope({ ...base, protocolVersion: '0.2.0' }, options).reason, 'unsupported_protocol');
    const cache = api.protocol.createReplayCache(); assert.equal(cache.seen('example-addon','request-123'),false); assert.equal(cache.seen('example-addon','request-123'),true); cache.clear(); assert.equal(cache.seen('example-addon','request-123'),false);
  } finally { await e.close(); }
});

test('two selected project identities produce disjoint bridge events', async () => {
  const first = await bundle(), second = await bundle({ projectId: 'other-project' });
  assert(first.outputFiles[0].text.includes('aperture-example'));
  assert(!first.outputFiles[0].text.includes('other-project'));
  assert(second.outputFiles[0].text.includes('other-project'));
});

test('client ignores a forged correlation and disposes pending timers', async () => {
  const e = await environment();
  try {
    e.register();
    const forge = event => {
      const request = event.detail;
      if (request.type !== 'core-action') return;
      e.window.dispatchEvent(new e.window.CustomEvent(request.replyEvent, { detail: {
        ok: true, value: 'forged', protocolVersion: '0.1.0', projectId: request.projectId,
        instanceId: request.instanceId, addonId: 'example-addon', requestId: 'wrong-request',
      } }));
    };
    e.window.addEventListener(e.api.contract.ADDONS_DEV_COMMAND_EVENT, forge);
    const result = await e.client.invokeCoreAction('storage.get', { key: 'missing', defaultValue: 'actual' });
    assert.equal(result.value, 'actual');
    e.window.removeEventListener(e.api.contract.ADDONS_DEV_COMMAND_EVENT, forge);
    e.api.service.shutdownAddonsService('timeout-test');
    assert.equal((await e.client.invokeCoreAction('storage.get', {}, 10)).reason, 'timeout');
    const pending = e.client.invokeCoreAction('storage.get', {}, 10000);
    assert.equal(e.client.getPendingRequestCount(), 1);
    e.client.dispose();
    assert.equal((await pending).reason, 'bridge_disposed');
    assert.equal(e.client.getPendingRequestCount(), 0);
  } finally { await e.close(); }
});

test('queued storage commit rechecks authorization after an asynchronous read', async () => {
  let release, started, hold = false;
  const gate = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { started = resolve; });
  const hooks = { get: async key => {
    if (hold && key.endsWith(':config')) { hold = false; started(); await gate; }
    return { handled: false };
  } };
  const e = await environment({ hooks });
  try {
    e.register();
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'initial', value: true })).ok, true);
    const currentKey = e.api.settings.CONFIG_ENVELOPE_KEY;
    hooks.get = async key => { if (hold && key === currentKey) { hold = false; started(); await gate; } return { handled: false }; };
    hold = true;
    const writing = e.client.invokeCoreAction('storage.set', { key: 'late', value: true });
    await observed;
    e.api.registry.updateAddonStatus('example-addon', 'disabled'); release();
    assert.equal((await writing).ok, false);
    assert(!e.api.state.config.addons.byAddon['example-addon'].state.late);
  } finally { release(); await e.close(); }
});

test('original rate limiter permits bounded cleanup while throttled', async () => {
  const e = await environment();
  try {
    e.register();
    e.api.state.config.addons.service.apiThrottle.coreActionRateMax = 1;
    assert.equal((await e.client.invokeCoreAction('storage.get', { key: 'x' })).ok, true);
    assert.equal((await e.client.invokeCoreAction('storage.get', { key: 'x' })).reason, 'rate_limited');
    assert.equal((await e.client.invokeCoreAction('ui.style.unregister', { styleId: 'missing' })).ok, true);
  } finally { await e.close(); }
});

test('original observer quota and disable cleanup apply to generic routes', async () => {
  const e = await environment();
  try {
    e.register();
    for (let i = 0; i < 4; i++) assert.equal((await e.client.invokeCoreAction('observer.watch', { observerId: 'watch-' + i })).ok, true);
    assert.equal((await e.client.invokeCoreAction('observer.watch', { observerId: 'overflow' })).reason, 'observer_subscription_limit');
    assert.equal((await e.client.invokeCoreAction('feature.disable')).ok, true);
    assert.equal((await e.client.invokeCoreAction('feature.enable')).ok, true);
    assert.equal((await e.client.invokeCoreAction('observer.watch', { observerId: 'new-watch' })).ok, true);
  } finally { await e.close(); }
});

test('extension families cannot replace a preserved built-in action family', async () => {
  await assert.rejects(environment({ policy: { extensions: { families: { toast: [] } } } }), /Duplicate public add-on action family/);
});

test('extension dependencies cannot replace preserved built-in machinery', async () => {
  await assert.rejects(environment({ policy: { extensions: { dependencies: { storage: {} } } } }), /Duplicate add-on dependency family/);
});

test('explicit local catalog reload revokes trust before a delayed storage commit', async () => {
  let release, started, hold = false, currentKey;
  const gate = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { started = resolve; });
  const hooks = { get: async key => { if (hold && key === currentKey) { hold = false; started(); await gate; } return { handled: false }; } };
  const e = await environment({ hooks, policy: { catalog: [{ ...descriptor, trusted: true }] } });
  try {
    e.register();
    assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'initial', value: true })).ok, true);
    currentKey = e.api.settings.CONFIG_ENVELOPE_KEY; hold = true;
    const writing = e.client.invokeCoreAction('storage.set', { key: 'revoked', value: true });
    await observed;
    e.api.testPolicy.default.catalog[0].trusted = false;
    await e.api.catalog.reloadTrustedAddonCatalog(); release();
    assert.equal((await writing).ok, false);
    assert(!e.api.state.config.addons.byAddon['example-addon'].state.revoked);
  } finally { release(); await e.close(); }
});

test('two actual projects share a page without bridge, storage or owned UI collisions', async () => {
  const first = await environment();
  let second;
  try {
    second = await environment({ projectId: 'other-project', window: first.window });
    first.register(); second.register();
    for (const [e, value] of [[first, 'one'], [second, 'two']]) {
      assert.equal((await e.client.invokeCoreAction('storage.set', { key: 'shared-key', value })).ok, true);
      assert.equal((await e.client.invokeCoreAction('ui.mount', { mountId: 'same-mount', slot: 'page.panel', html: '<div>Owned</div>' })).ok, true);
    }
    assert.equal((await first.client.invokeCoreAction('storage.get', { key: 'shared-key' })).value, 'one');
    assert.equal((await second.client.invokeCoreAction('storage.get', { key: 'shared-key' })).value, 'two');
    const mounts = [...first.window.document.querySelectorAll('[data-addon-mount-id="same-mount"]')];
    assert.equal(mounts.length, 2); assert.notEqual(mounts[0].id, mounts[1].id);
    assert.equal((await first.client.invokeCoreAction('feature.disable')).ok, true);
    assert.equal(first.api.ui.getAddonUiPolicySnapshot().owners.mounts.length, 0);
    assert.equal(second.api.ui.getAddonUiPolicySnapshot().owners.mounts.length, 1);
  } finally { if (second) await second.close(); await first.close(); }
});


test('no catalog endpoint performs no requests or cache writes, including a legacy policy URL', async () => {
  const e=await environment({policy:{catalogMetaUrl:'https://retired.example.org/meta.json',catalogBaseUrl:'https://retired.example.org/'}});
  try {
    const repository=e.api.catalog.createTrustedCatalogRepository({storage:{get:()=>{throw Error('unexpected read')},set:()=>{throw Error('unexpected write')}},fetchImpl:()=>{throw Error('unexpected fetch')}});
    assert.equal((await repository.load({force:true})).source,'project');
    assert.equal(e.api.catalog.TRUSTED_CATALOG_META_URL,'');assert.equal(e.api.catalog.listTrustedAddonCatalog().length,1);
  }finally{await e.close();}
});

test('configured catalog preserves query, hash verification, throttling and endpoint-bound caches', async () => {
  const endpoint='https://updates.example.org/catalog/meta.json?channel=stable';
  const e=await environment({addonUpdates:{catalogURL:endpoint}});
  try {
    const catalog=[{...descriptor,trusted:true}],identifier=require('node:crypto').createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
    const filename='trusted-addon-catalog.'+identifier.slice(0,16)+'.json';
    const calls=[],map=new Map();let time=1000,bad=false;
    const repository=e.api.catalog.createTrustedCatalogRepository({now:()=>time,hashCatalog:c=>require('node:crypto').createHash('sha256').update(JSON.stringify(c)).digest('hex'),storage:{get:async(k,f)=>map.get(k)||f,set:async(k,v)=>map.set(k,plain(v))},fetchImpl:async(url,options)=>{
      calls.push(url);assert.equal(options.credentials,'omit');
      return {ok:true,json:async()=>url.includes('meta.json')?{identifier,catalogFile:filename}:{schemaVersion:1,identifier,catalog:bad?[{...catalog[0],name:'tampered'}]:catalog}};
    }});
    assert.equal((await repository.load({force:true})).source,'remote');
    assert.equal(new URL(calls[0]).searchParams.get('channel'),'stable');
    assert.equal(calls[1],'https://updates.example.org/catalog/'+filename);
    assert.equal((await repository.load()).source,'cache');assert.equal(calls.length,2);
    assert.equal((await repository.load({force:true})).source,'not-modified');assert.equal(calls.length,3);
    map.get(e.api.catalog.TRUSTED_CATALOG_CACHE_KEY).sourceUrl='https://other.example.org/meta.json';
    bad=true;const result=await repository.load({force:true});assert.equal(result.ok,false);assert.equal(e.api.catalog.isCatalogFresh(),false);
    assert.deepEqual(map.get(e.api.catalog.TRUSTED_CATALOG_CACHE_KEY).catalog,[]);
  }finally{await e.close();}
});


test('tab definitions reserve core panels and reject duplicate IDs, sections and invalid hooks', async()=>{
  const e=await environment();try{
    const define=e.api.tabs.defineSettingsTabs;
    for(const input of [{tabs:{}},{tabs:[{id:'global',label:'X'}]},{tabs:[{id:'addons',label:'X'}]},{tabs:[{id:'a',label:'A'},{id:'a',label:'B'}]},{tabs:[{id:'a',label:'A',order:NaN}]},{tabs:[{id:'a',label:'A',component:{}}]},{tabs:[{id:'a',label:'A',sections:{global:{}}}]},{tabs:[{id:'a',label:'A',sections:{shared:{}}},{id:'b',label:'B',sections:{shared:{}}}]}])assert.throws(()=>define(input));
    const model=define({panels:[],tabs:[{id:'later',label:'Later',order:20,sections:{laterSettings:{settings:{}}}},{id:'earlier',label:'Earlier',order:1}]});
    assert.deepEqual(plain(model.tabs.map(t=>t.id)),['general','addins','earlier','later']);
    assert.equal(model.containers.global,'global-settings-container');assert.equal(model.containers.laterSettings,'settings-section-laterSettings');
  }finally{await e.close();}
});

test('metadata tabs generate settings containers, persist values and dispose components exactly once', async()=>{
  const uiDefinition=`export default {panels:[],tabs:[{id:'custom',label:'Custom tools',sections:{customFields:{label:'Options',settings:{customPageSize:{type:'number',text:'Page size',config:'preferences.pageSize',input:{min:1,max:100,step:1}}}}},component:{mount({container,listen,resources}){window.tabMounts=(window.tabMounts||0)+1;const button=document.createElement('button');button.textContent='Component';container.append(button);listen('click',button,'click',()=>window.tabClicks=(window.tabClicks||0)+1);resources.register('extra',()=>window.tabReleased=(window.tabReleased||0)+1);return()=>{window.tabCleaned=(window.tabCleaned||0)+1;button.remove();};}}}]};`;
  const e=await environment({uiDefinition});try{
    await e.api.modal.openModal();await e.api.modal.openModal();
    const root=e.api.state.stateManager.get('shadowRoot');
    assert(root.getElementById('settings-panel-general'));assert(root.getElementById('settings-panel-addins'));assert.equal(root.querySelectorAll('[data-target="settings-panel-custom"]').length,1);
    assert.equal(e.window.tabMounts,1);const panel=root.getElementById('settings-panel-custom');panel.querySelector('button').click();assert.equal(e.window.tabClicks,1);
    const input=root.getElementById('setting-customPageSize');input.value='27';input.dispatchEvent(new e.window.Event('change'));
    await new Promise(resolve=>setTimeout(resolve,10));assert.equal(e.api.state.config.preferences.pageSize,27);
    await e.api.teardown.teardownAll('tab-test');assert.equal(e.window.tabCleaned,1);assert.equal(e.window.tabReleased,1);
  }finally{await e.close();}
});

test('late mounts and failed tab components cannot leak resources or block healthy tabs', async()=>{
  const uiDefinition=`export default {tabs:[{id:'late',label:'Late',component:{mount({container,resources,listen}){return new Promise(resolve=>{window.finishTab=()=>{resources.register('late',()=>window.lateResourceCleaned=true);listen('late',container,'click',()=>window.leakedListener=true);resolve(()=>window.lateCleaned=true);};});}}},{id:'failed',label:'Failed',component:{mount(){throw Error('fixture failure');}}},{id:'healthy',label:'Healthy',sections:{healthyFields:{settings:{}}}}]};`;
  const e=await environment({uiDefinition});try{
    await e.api.modal.openModal();const root=e.api.state.stateManager.get('shadowRoot');assert(root.getElementById('settings-panel-healthy'));assert.equal(root.querySelector('[data-settings-component="failed"]').textContent,'This panel could not be loaded.');
    const late=root.querySelector('[data-settings-component="late"]');await e.api.teardown.teardownAll('cancel-tabs');e.window.finishTab();await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(e.window.lateCleaned,true);assert.equal(e.window.lateResourceCleaned,true);late.click();assert.equal(e.window.leakedListener,undefined);
  }finally{await e.close();}
});

test('untrusted add-on access remains default-off and can be enabled and revoked without bypassing catalog identity', async()=>{
 const e=await environment({policy:{catalog:[]}});
 try {
  e.register();assert.equal((await e.client.invokeCoreAction('storage.set',{key:'untrusted',value:1})).ok,false);
  const enabled=await e.api.settings.updateConfig(draft=>{draft.addons.service.allowUntrusted=true;});assert.equal(enabled.committed,true);
  e.register();assert.equal((await e.client.invokeCoreAction('storage.set',{key:'untrusted',value:1})).ok,true);
  const revoked=await e.api.settings.updateConfig(draft=>{draft.addons.service.allowUntrusted=false;});assert.equal(revoked.committed,true);
  assert.equal((await e.client.invokeCoreAction('storage.set',{key:'untrusted',value:2})).ok,false);
 } finally {await e.close();}
 const known=await environment();try {await known.api.settings.updateConfig(draft=>{draft.addons.service.allowUntrusted=true;});known.register({version:'99.0.0'});assert.equal((await known.client.invokeCoreAction('storage.set',{key:'mismatch',value:1})).ok,false);}finally {await known.close();}
});
