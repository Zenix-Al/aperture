const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ROOT, bundle, descriptor } = require('./addon-platform-helpers.cjs');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { buildAddonToPath } = require('../addons/build-addon.js');

for (const theme of ['default', 'light']) test('Chromium actual core and example add-on: ' + theme + ' theme, persistence, lifecycle and cleanup', async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="host">Disposable example host</main>' }));
    await page.addInitScript(() => { globalThis.GM = {
      info: { scriptHandler: 'Chromium GM stand-in' },
      getValue: async (key, fallback) => { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); },
      setValue: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
      deleteValue: async key => localStorage.removeItem(key),
    }; });
    const core = await bundle({ theme, routePrefix: "/example/" });
    const project = loadProject({ rootDir: ROOT });
    const output = path.join(ROOT, 'tests/.tmp/addon-platform-example.user.js');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const addon = await buildAddonToPath(descriptor, false, { project, outputPath: output, deterministicHeader: true, metafile: true });
    assert(!/cdn\.jsdelivr/.test(addon.code));
    assert(!Object.keys(addon.metafile.inputs).some(file => /latestMarkers/.test(file)));
    await page.goto('http://localhost/example/start'); await page.addScriptTag({ content: core.outputFiles[0].text });
    await page.evaluate(() => __addons.main.startRuntime());
    await page.addScriptTag({ content: addon.code });
    await page.waitForFunction(() => __addons.registry.listRegisteredAddons().some(addon => addon.id === 'example-addon' && addon.trusted));
    await page.waitForFunction(() => __addons.ui.getAddonUiPolicySnapshot().owners.styles.length > 0);
    await page.evaluate(async () => {
      globalThis.testClient = __addons.client.createCoreBridge('example-addon');
      await testClient.waitForCorePing();
      globalThis.saved = await testClient.invokeCoreAction('storage.set', { key: 'browser', value: 'persisted' });
    });
    assert.equal(await page.evaluate(() => saved.ok), true);
    const pageHost = page.locator('div[data-addon-id="example-addon"]').first();
    await pageHost.waitFor();
    const inherited = await pageHost.evaluate(node => getComputedStyle(node).getPropertyValue('--aperture-accent').trim());
    assert.equal(inherited, theme === 'light' ? '#315ca8' : '#893839');
    await page.evaluate(() => __addons.modal.openModal());
    await page.locator('button[data-target="settings-panel-addins"]').click();
    await page.locator('button[data-addon-action="open-addon-panel"][data-addon-id="example-addon"]').click();
    const setting = page.locator('input[data-addon-setting-path="panelLogLimit"]');
    await setting.fill('31'); await setting.dispatchEvent('change');
    await page.waitForFunction(() => __addons.state.config.addons.byAddon['example-addon']?.state?.settings?.panelLogLimit === 31);
    const disabled = await page.evaluate(() => testClient.invokeCoreAction('feature.disable'));
    assert.equal(disabled.ok, true);
    await page.waitForFunction(() => Object.values(__addons.ui.getAddonUiPolicySnapshot().owners).flat().length === 0);
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('storage.set', { key: 'browser', value: 'denied' }))).reason, 'addon_disabled');
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('feature.enable'))).ok, true);
    await page.waitForFunction(() => __addons.ui.getAddonUiPolicySnapshot().owners.styles.length > 0);
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('storage.get', { key: 'browser' }))).value, 'persisted');
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('idb.put', { dbName: 'browser', storeName: 'records', key: 'one', value: { id: 'one', hello: 'world' } }))).ok, true);
    await page.evaluate(() => history.pushState({}, '', '/outside'));
    await page.waitForFunction(() => Object.values(__addons.ui.getAddonUiPolicySnapshot().owners).flat().length === 0);
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('storage.set', { key: 'browser', value: 'out-of-scope' }))).ok, false);
    await page.evaluate(() => history.pushState({}, '', '/example/return'));
    await page.waitForFunction(() => __addons.ui.getAddonUiPolicySnapshot().owners.styles.length > 0);
    assert.equal((await page.evaluate(() => testClient.invokeCoreAction('storage.get', { key: 'browser' }))).value, 'persisted');
    await page.reload();
    await page.addScriptTag({ content: core.outputFiles[0].text });
    await page.evaluate(() => __addons.main.startRuntime());
    await page.addScriptTag({ content: addon.code });
    await page.waitForFunction(() => __addons.ui.getAddonUiPolicySnapshot().owners.styles.length > 0);
    assert.equal(await page.evaluate(() => __addons.state.config.addons.byAddon['example-addon'].state.browser), 'persisted');
    assert.equal(await page.evaluate(() => __addons.state.config.addons.byAddon['example-addon'].state.settings.panelLogLimit), 31);
    await page.evaluate(() => __addons.teardown.teardownAll('browser-test'));
    assert.equal(await page.locator('[data-addon-id="example-addon"]').count(), 0);
    assert.equal(await page.evaluate(() => __addons.bridge.getAddonsBridgeDiagnostics().listenerBound), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});


test('renamed generic example uses configured identity, owned styles and original lifecycle',async()=>{
  const browser=await chromium.launch({headless:true});const errors=[];
  try{
    const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<main>Neutral host</main>'}));
    await page.addInitScript(()=>{const values=new Map();globalThis.GM={getValue:async(k,f)=>values.has(k)?values.get(k):f,setValue:async(k,v)=>values.set(k,v),deleteValue:async k=>values.delete(k)};});
    const renamed={...descriptor,id:'neutral-demo',name:'Neutral Demo'};
    const core=await bundle({policy:{catalog:[{...renamed,trusted:true}]}});
    const project=loadProject({rootDir:ROOT});const temporary=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'aperture-neutral-addon-'));
    let built;try{built=await buildAddonToPath(renamed,false,{project,outputPath:path.join(temporary,'addon.user.js'),deterministicHeader:true});}finally{fs.rmSync(temporary,{recursive:true,force:true});}
    await page.goto('http://localhost/');await page.addScriptTag({content:core.outputFiles[0].text});await page.evaluate(()=>__addons.main.startRuntime());await page.addScriptTag({content:built.code});
    await page.waitForFunction(()=>__addons.registry.listRegisteredAddons().some(a=>a.id==='neutral-demo'&&a.trusted));
    await page.getByRole('button',{name:'Neutral Demo API',exact:true}).click();
    await page.getByRole('heading',{name:'Neutral Demo Playground'}).waitFor();
    assert.equal(await page.locator('.aperture-addon-dialog-content[data-addon-id="neutral-demo"]').evaluate(node=>getComputedStyle(node).paddingTop),'18px');
    assert.equal(await page.locator('[data-addon-id="example-addon"]').count(),0);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
    await page.waitForFunction(()=>!document.querySelector('[data-addon-id="neutral-demo"]'));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
