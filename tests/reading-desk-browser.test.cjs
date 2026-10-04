const { evidencePath } = require('./evidence-path.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const { ROOT, buildDemo, serveDemo } = require('../scripts/reading-desk.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');

async function clientCode(project) {
  const result = await esbuild.build({ stdin: { contents: "import {createCoreBridge} from './addons/shared/coreBridge.js'; globalThis.demoClient=createCoreBridge('example-addon');", resolveDir: ROOT }, bundle: true, write: false, format: 'iife', plugins: [projectInputs(project)] });
  return result.outputFiles[0].text;
}
function contrast(a, b) {
  const luminance = text => {
    const channels = text.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
for (const theme of ['default', 'light']) test('Reading Desk generated scripts on real local HTTP: ' + theme, async () => {
  const demo = await buildDemo({ theme });
  const server = await serveDemo(demo, 0);
  const browser = await chromium.launch({ headless: true });
  const evidence = { theme, adapter: 'Chromium GM stand-in; generated production scripts on localhost:4173' };
  try {
    const page = await browser.newPage();
    // Keep production match URLs while using an isolated HTTP fixture port.
    await page.route('http://localhost:4173/**', async route => {
      const response = await route.fetch({ url: route.request().url().replace(':4173/', ':' + server.address().port + '/') });
      await route.fulfill({ response });
    });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      globalThis.gmKeys = [];
      globalThis.GM = { getValue: async (key, fallback) => { gmKeys.push(key); const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }, setValue: async (key, value) => { gmKeys.push(key); localStorage.setItem(key, JSON.stringify(value)); }, deleteValue: async key => { gmKeys.push(key); localStorage.removeItem(key); } };
    });
    const core = demo.core.artifacts.find(row => !row.filename.includes('uglified')).contents;
    const client = await clientCode(demo.project);
    async function install() { await page.addScriptTag({ content: core }); await page.addScriptTag({ content: demo.addon.code }); await page.addScriptTag({ content: client }); await page.evaluate(() => demoClient.waitForCorePing()); }
    await page.goto('http://localhost:4173/reading/one');
    const hostBefore = await page.evaluate(() => {
      const node = document.createElement('div'); node.id = 'host-selector-collision'; node.className = 'reading-desk-helper'; node.textContent = 'Host content with a matching class'; document.body.append(node);
      const style = getComputedStyle(node); return { color: style.color, background: style.backgroundColor, border: style.borderTopWidth };
    });
    await install();
    await page.locator('[data-reading-helper]').waitFor();
    await page.locator('[data-reading-save]').waitFor();
    assert.equal(await page.locator('[data-reading-helper]').count(), 1);
    assert.deepEqual(await page.locator('#host-selector-collision').evaluate(node => { const style = getComputedStyle(node); return { color: style.color, background: style.backgroundColor, border: style.borderTopWidth }; }), hostBefore);
    assert.equal(await page.locator('html').getAttribute('data-reading-desk-ready'), 'true');
    await page.locator('[data-reading-save]').click();
    await page.getByText('Bookmark saved; reload to verify.').waitFor();
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('storage.get', { key: 'bookmark' }))).value.path, '/reading/one');
    const mount = page.locator('[data-addon-id="example-addon"][data-addon-mount-id="reading-note"]');
    const styles = await mount.evaluate(node => ({ inherited: getComputedStyle(node).getPropertyValue('--aperture-accent').trim(), local: getComputedStyle(node.querySelector('.reading-note')).getPropertyValue('--aperture-accent').trim() }));
    assert.equal(styles.inherited, theme === 'light' ? '#315ca8' : '#893839'); assert.equal(styles.local, '#52799b');
    const presentation = await mount.locator('.reading-note').evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor, host: getComputedStyle(document.body).backgroundColor }));
    assert(contrast(presentation.color, presentation.background) >= 4.5);
    assert.equal(presentation.host, 'rgb(244, 241, 233)');
    await page.locator('[data-reading-save]').focus();
    assert.equal(await page.locator('[data-reading-save]').evaluate(node => getComputedStyle(node).outlineWidth), '3px');
    await page.setViewportSize({ width: 360, height: 740 }); await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Shelf route', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-reading-helper]') && !document.querySelector('[data-reading-save]'));
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('storage.set', { key: 'bookmark', value: 'denied' }))).ok, false);
    await page.getByRole('button', { name: 'Reading route', exact: true }).click();
    await page.locator('[data-reading-helper]').waitFor(); await page.locator('[data-reading-save]').waitFor();
    await page.getByRole('button', { name: 'Hide reading helper' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-reading-helper]'));
    await page.reload(); await install();
    await page.locator('[data-reading-save]').waitFor();
    assert.equal(await page.locator('[data-reading-helper]').count(), 0);
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('storage.get', { key: 'bookmark' }))).value.path, '/reading/one');
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.locator('button[data-target="settings-panel-general"]').click();
    for (const key of ['configVisibility','configTransfer','featureHealth','addonsServiceSettings']) assert.equal(await page.locator('#global-settings-container [data-setting-key="'+key+'"]').count(),1);
    assert.equal(await page.locator('.settings-framework-version').innerText(), 'Aperture v' + require('../package.json').version);
    assert.equal(await page.locator('.settings-framework-version').isVisible(), true);
    await page.locator('#setting-configVisibility').uncheck();
    await page.waitForFunction(() => document.querySelector('[data-aperture-ui-owner="reading-desk:reading_desk"]')?.shadowRoot?.querySelector('#aperture-page-dock')?.dataset.hideMode === 'auto');
    await page.locator('#setting-configVisibility').check();
    await page.waitForFunction(() => document.querySelector('[data-aperture-ui-owner="reading-desk:reading_desk"]')?.shadowRoot?.querySelector('#aperture-page-dock')?.dataset.hideMode === 'manual');
    await page.locator('[data-setting-key="configTransfer"] button').click();
    assert.equal(await page.locator('.config-dialog-title').innerText(),'Import / Export Settings');
    assert.equal(await page.locator('.config-dialog-backdrop').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0.6)');
    await page.locator('.config-dialog-actions').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('[data-setting-key="featureHealth"] button').click();
    await page.locator('#feature-health-box').waitFor();
    assert((await page.locator('#feature-health-box .feature-health-content').innerText()).includes('Framework: Aperture v' + require('../package.json').version));
    await page.locator('#feature-health-box').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('[data-setting-key="addonsServiceSettings"] button').click();
    assert.equal(await page.locator('.config-dialog-title').innerText(),'Add-ons Service Settings');
    assert.equal(await page.locator('#setting-dialog-allowUntrustedAddons').count(),1);
    assert.equal(await page.locator('#setting-dialog-allowUntrustedAddons').isChecked(),false);
    assert.equal(await page.locator('#setting-dialog-allowUntrustedAddons').evaluate(node => getComputedStyle(node.closest('.config-row').querySelector('label')).fontSize),'14px');
    await page.locator('#setting-dialog-allowUntrustedAddons').click();
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('[data-setting-key="addonsServiceSettings"] button').click();
    assert.equal(await page.locator('#setting-dialog-allowUntrustedAddons').isChecked(),false);
    await page.locator('#setting-dialog-allowUntrustedAddons').click();
    await page.getByRole('button',{name:'I understand, enable',exact:true}).click();
    await page.locator('[data-setting-key="addonsServiceSettings"] button').click();
    await page.waitForFunction(()=>document.querySelector('[data-aperture-ui-owner="reading-desk:reading_desk"]')?.shadowRoot?.querySelector('#setting-dialog-allowUntrustedAddons')?.checked === true);
    await page.locator('#setting-dialog-allowUntrustedAddons').uncheck();

    await page.locator('#setting-dialog-coreActionRateMax').fill('101');
    await page.locator('#setting-dialog-coreActionRateMax').dispatchEvent('change');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('aperture:reading-desk:reading_desk:config'))?.data?.addons?.service?.apiThrottle?.coreActionRateMax === 101);
    await page.locator('.config-dialog-actions').getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('button[data-target="settings-panel-reading"]').click();
    await page.getByRole('button',{name:'Show reading status',exact:true}).click();
    assert.equal(await page.locator('[data-reading-settings-status]').innerText(),'Reading helper disabled');
    await page.locator('label[for="setting-readingEnabled"]').click();
    await page.locator('[data-reading-helper]').waitFor();
    const shadow = await page.locator('#setting-readingEnabled').evaluate(node => {
      const host = node.getRootNode().host;
      return { token: getComputedStyle(host).getPropertyValue('--aperture-accent').trim(), shadow: node.getRootNode() instanceof ShadowRoot };
    });
    assert.equal(shadow.shadow, true); assert.equal(shadow.token, styles.inherited);
    const corePresentation = await page.locator('.modal-content').evaluate(node => ({ color: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }));
    assert(contrast(corePresentation.color, corePresentation.background) >= 4.5);
    await page.locator('button[data-target="settings-panel-addins"]').click();
    await page.locator('button[data-addon-action="open-addon-panel"][data-addon-id="example-addon"]').click();
    await page.locator('input[data-addon-setting-path="reminder"]').evaluate(node => { node.checked = false; node.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.reload(); await install(); await page.locator('[data-reading-save]').waitFor();
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('storage.get', { key: 'settings' }))).value.reminder, false);
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('feature.disable'))).ok, true);
    await page.waitForFunction(() => !document.querySelector('[data-reading-save]'));
    assert.equal((await page.evaluate(() => demoClient.invokeCoreAction('feature.enable'))).ok, true);
    await page.locator('[data-reading-save]').waitFor();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.waitForFunction(() => !document.querySelector('[data-reading-save]') && !document.documentElement.hasAttribute('data-reading-desk-ready'));
    assert.equal(await page.evaluate(() => gmKeys.some(key => /latest|library/i.test(key))), false);
    assert.deepEqual(errors, []);
    evidence.styles = styles; evidence.shadow = shadow; evidence.presentation = presentation; evidence.corePresentation = corePresentation; evidence.managerKeys = await page.evaluate(() => [...new Set(gmKeys)]); evidence.pageErrors = errors;
    require('node:fs').writeFileSync(evidencePath('example/browser-' + theme + '.json'), JSON.stringify(evidence, null, 2) + '\n');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('Reading Desk handles delayed/missing core, stale page work, denied capabilities and failed writes', async () => {
  const demo = await buildDemo(); const server = await serveDemo(demo, 0); const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Keep production match URLs while using an isolated HTTP fixture port.
    await page.route('http://localhost:4173/**', async route => {
      const response = await route.fetch({ url: route.request().url().replace(':4173/', ':' + server.address().port + '/') });
      await route.fulfill({ response });
    }); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:4173/reading/one');
    await page.addScriptTag({ content: demo.addon.code });
    // A missing core expires the original bounded handshake, leaving no owned UI.
    await page.waitForTimeout(3150);
    assert.equal(await page.locator('[data-reading-save]').count(), 0);
    await page.reload();
    await page.evaluate(() => {
      localStorage.setItem('aperture:other:other:config', 'untouched');
      globalThis.writeDenied = false;
      globalThis.GM = { getValue: async (key, fallback) => { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }, setValue: async (key, value) => { if (writeDenied) throw new Error('Disposable manager write denied'); localStorage.setItem(key, JSON.stringify(value)); }, deleteValue: async key => localStorage.removeItem(key) };
    });
    await page.addScriptTag({ content: demo.addon.code });
    await page.waitForTimeout(100);
    await page.addScriptTag({ content: demo.core.artifacts.find(row => !row.filename.includes('uglified')).contents });
    await page.addScriptTag({ content: await clientCode(demo.project) });
    await page.evaluate(() => demoClient.waitForCorePing());
    await page.locator('[data-reading-save]').waitFor();
    await page.getByRole('button', { name: 'Shelf route', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-reading-helper]').count(), 0);
    await page.getByRole('button', { name: 'Reading route', exact: true }).click();
    // Change route while the production body feature's asynchronous work is pending.
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-reading-helper]').count(), 0);
    await page.getByRole('button', { name: 'Shelf route', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-reading-helper]').count(), 0);
    await page.getByRole('button', { name: 'Reading route', exact: true }).click();
    await page.locator('[data-reading-helper]').waitFor(); await page.locator('[data-reading-save]').waitFor();
    await page.getByRole('button', { name: 'Reading route', exact: true }).click();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-reading-helper]').count(), 1);
    assert.equal(await page.locator('[data-reading-save]').count(), 1);
    const denied = await page.evaluate(() => demoClient.invokeCoreAction('page.getContext'));
    assert.equal(denied.ok, false); assert.equal(denied.reason, 'permission_denied');
    await page.evaluate(() => { writeDenied = true; });
    await page.getByRole('button', { name: 'Hide reading helper' }).click();
    await page.getByText('Settings could not be saved. Check storage readiness before retrying.').waitFor();
    assert.equal(await page.locator('[data-reading-helper]').count(), 1);
    await page.locator('[data-reading-save]').click();
    await page.locator('[data-reading-status]').filter({ hasText: 'Could not save:' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('aperture:other:other:config')), 'untouched');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await page.waitForFunction(() => !document.querySelector('[data-reading-helper]') && !document.querySelector('[data-reading-save]'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
