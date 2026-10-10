const { evidencePath } = require('./evidence-path.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { ROOT, bundle } = require('./theme-helpers.cjs');
const { validateTheme } = require('../scripts/themeContract.cjs');
function rgb(hex){return `rgb(${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)})`;}

test('core-only production example keeps settings, persistence, transfer and diagnostics without platform UI or storage', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const optional = require('./optional-addons-helpers.cjs'), built = await optional.bundle();
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Core-only example</main>' }));
    await page.addInitScript(() => { globalThis.operations = []; globalThis.GM = {
      info: { scriptHandler: 'Chromium fixture' },
      getValue: async (key, fallback) => { operations.push(['get', key]); const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); },
      setValue: async (key, value) => { operations.push(['set', key]); localStorage.setItem(key, JSON.stringify(value)); },
      deleteValue: async key => { operations.push(['delete', key]); localStorage.removeItem(key); },
    }; });
    await page.goto('http://localhost/'); await page.addScriptTag({ content: built.code });
    await page.locator('#tag-config-button').click();
    await page.locator('#setting-pageSize').waitFor();
    assert.equal(await page.locator('[data-target="settings-panel-addins"]').count(), 0);
    assert.equal(await page.locator('#settings-nav-pinned-group').count(), 0);
    assert.equal(await page.locator('#aperture-page-dock-addon-slot').count(), 0);
    assert.equal(await page.locator('[data-setting-key="addonsServiceSettings"]').count(), 0);
    await page.locator('#setting-pageSize').fill('31'); await page.locator('#setting-pageSize').dispatchEvent('change');
    const key = `aperture:${built.project.id}:${built.project.storageNamespace}:config`;
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).data.preferences.pageSize === 31, key);
    await page.locator('[data-setting-key="featureHealth"] button').click();
    const health = await page.locator('.feature-health-content').textContent();
    assert.match(health, /Storage: state=ready/); assert.match(health, /Framework: Aperture v/); assert(!/add-on/i.test(health));
    await page.locator('[data-setting-key="configTransfer"] button').click();
    assert.equal(await page.locator('#latest-config-dialog').count(), 1);
    const stored = await page.evaluate(key => ({ data: JSON.parse(localStorage.getItem(key)).data, operations }), key);
    assert(!Object.hasOwn(stored.data, 'addons')); assert(!stored.operations.some(([, key]) => /addon/i.test(key)));
    await page.reload(); await page.addScriptTag({ content: built.code }); await page.locator('#tag-config-button').click();
    assert.equal(await page.locator('#setting-pageSize').inputValue(), '31');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForFunction(() => !document.querySelector('[data-aperture-ui-owner]'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
for(const theme of ['default','light'])test('Chromium '+theme+': original settings, dialogs, owned add-on styles, accessibility and cleanup',async()=>{
 const browser=await chromium.launch({headless:true});const errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1200,height:850},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<style>body{color:rgb(7,8,9);background:rgb(1,2,3);font:700 24px/1.8 serif}</style><main id="website">Host website</main>'}));
  await page.addInitScript(()=>{globalThis.GM={info:{scriptHandler:'Chromium stand-in'},getValue:async(k,f)=>{const v=localStorage.getItem(k);return v===null?f:JSON.parse(v)},setValue:async(k,v)=>localStorage.setItem(k,JSON.stringify(v)),deleteValue:async k=>localStorage.removeItem(k)};});
  const built=await bundle(theme);await page.goto('http://localhost/');await page.addScriptTag({content:built.code});
  await page.evaluate(async()=>{await __theme.main.startRuntime();await __theme.modal.openModal();});
  const tokens=validateTheme(fs.readFileSync(path.join(ROOT,'themes',theme,'index.css'),'utf8')).tokens;
  const core=await page.evaluate(()=>{const sr=__theme.state.stateManager.get('shadowRoot'),css=s=>getComputedStyle(sr.querySelector(s));return{
   framework:sr.querySelector('.settings-framework-version').textContent,modal:css('.modal-content').backgroundColor,sidebar:css('.settings-sidebar').backgroundColor,input:css('input[type=number]').backgroundColor,inputText:css('input[type=number]').color,
   labelSize:css('.config-row label').fontSize,labelWeight:css('.config-row label').fontWeight,activeNav:css('.settings-nav-item.active').backgroundColor,border:css('input[type=number]').borderTopColor,dock:css('#tag-config-button').backgroundColor,scrollbar:css('.settings-main').scrollbarColor,
   motion:css('#tag-config-button').transitionDuration,panels:sr.querySelectorAll('.settings-panel').length,nav:[...sr.querySelectorAll('.settings-nav-item')].map(n=>n.textContent.trim()),
   hostColor:getComputedStyle(document.body).color,hostBackground:getComputedStyle(document.body).backgroundColor,rootTokens:getComputedStyle(document.documentElement).getPropertyValue('--aperture-accent'),sheetCount:document.querySelectorAll('style[data-style-id^="ui-theme:"]').length};});
  assert.equal(core.framework,'Aperture v'+require('../package.json').version);assert.equal(core.labelSize,'14px');assert.equal(core.labelWeight,'500');assert.equal(core.activeNav,tokens['accent-subtle']);
  assert.equal(core.modal,rgb(tokens.modal));assert.equal(core.sidebar,rgb(tokens.sidebar));assert.equal(core.input,rgb(tokens.control));assert.equal(core.inputText,rgb(tokens['text-primary']));assert.equal(core.border,rgb(tokens['border-control']));assert.equal(core.dock,rgb(tokens['dock-accent']));assert(core.scrollbar.includes(rgb(tokens['scrollbar-thumb'])));assert.equal(core.motion,'0s');assert.equal(core.panels,2);assert.deepEqual(core.nav,['General','Add-ons']);assert.equal(core.hostColor,'rgb(7, 8, 9)');assert.equal(core.hostBackground,'rgb(1, 2, 3)');assert.equal(core.rootTokens,'');assert.equal(core.sheetCount,1);
  const presentation=await page.evaluate(()=>{const sr=__theme.state.stateManager.get('shadowRoot'),container=sr.querySelector('#global-settings-container');const values={};for(const variant of ['installed','error','disabled','needs-update']){const node=__theme.badge.createBadge(container,variant,variant);values[variant]=getComputedStyle(node).color;}const chip=document.createElement('div');chip.className='tag-chip aperture-chip';chip.textContent='Neutral chip';container.appendChild(chip);values.chip=getComputedStyle(chip).backgroundColor;const card=document.createElement('div');card.className='addins-card';container.appendChild(card);values.card=getComputedStyle(card).backgroundColor;return values;});
  assert.equal(presentation.installed,rgb(tokens.success));assert.equal(presentation.error,rgb(tokens.error));assert.equal(presentation.disabled,rgb(tokens.disabled));assert.equal(presentation['needs-update'],rgb(tokens.warning));assert.equal(presentation.chip,rgb(tokens.chip));assert.equal(presentation.card,rgb(tokens.card));
  const input=page.locator('#aperture-example-aperture_example-ui').locator('input[type=number]');await input.fill('36');await input.dispatchEvent('change');await page.waitForFunction(()=>__theme.state.config.preferences.pageSize===36);
  await page.evaluate(()=>{__theme.toast.showToast('Saved',10000,'success');__theme.dialog.openConfirmDialog({title:'Confirm original dialog'}).then(v=>globalThis.confirmed=v);});
  assert.equal(await page.evaluate(()=>getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('.toast')).backgroundColor),rgb(tokens['success-surface']));
  assert.equal(await page.evaluate(()=>getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('.config-dialog-panel')).backgroundColor),rgb(tokens.modal));
  assert.equal(await page.evaluate(()=>getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('.config-dialog-panel')).fontSize),'14px');
  assert.equal(await page.evaluate(()=>getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('.config-dialog-backdrop')).backgroundColor),tokens.backdrop);
  await page.locator('#aperture-example-aperture_example-ui').getByRole('button',{name:'Confirm',exact:true}).click();assert.equal(await page.evaluate(()=>confirmed),true);
  const addon=await page.evaluate(()=>{
   const a=__theme.addons;const outcomes=[];
   outcomes.push(a.mountAddonUi('addon-a',{mountId:'dock',slot:'page.dock',html:'<button class="demo">A dock</button>'}).ok);
   outcomes.push(a.mountAddonUi('addon-a',{mountId:'page',slot:'page.panel',position:'prepend',html:'<span>Owned A page</span>'}).ok);
   outcomes.push(a.mountAddonUi('addon-b',{mountId:'page',slot:'page.panel',html:'<button class="demo">B page</button>'}).ok);
   outcomes.push(a.registerAddonStyle('addon-a',{styleId:'tokens',cssText:'.aperture-addon-mount { --aperture-accent:#663399; } .demo { background:var(--aperture-accent); color:var(--aperture-on-accent); }'}).ok);
   outcomes.push(a.registerAddonStyle('addon-b',{styleId:'tokens',cssText:'.aperture-addon-mount { --aperture-accent:#117744; } .demo { background:var(--aperture-accent); }'}).ok);
   outcomes.push(a.openAddonDialog('addon-c',{dialogId:'theme',title:'C',html:'<button class="demo">Inherited</button>'}).ok);
   const unsafe=a.registerAddonStyle('addon-a',{styleId:'bad',cssText:'body {color:red}'});
   const sibling=a.registerAddonStyle('addon-a',{styleId:'sibling',cssText:'.aperture-addon-mount + div { color:#ff0000 !important; }'});
   const sr=__theme.state.stateManager.get('shadowRoot');
   return {outcomes,unsafe,sibling,a:getComputedStyle(sr.querySelector('[data-addon-id="addon-a"] .demo')).backgroundColor,b:getComputedStyle(document.querySelector('[data-addon-id="addon-b"] .demo')).backgroundColor,bRoot:getComputedStyle(document.querySelector('.aperture-addon-mount[data-addon-id="addon-b"]')).color,c:getComputedStyle(document.querySelector('.aperture-addon-dialog-surface')).backgroundColor,core:getComputedStyle(sr.querySelector('#tag-config-button')).backgroundColor};
  });
  assert(addon.outcomes.every(Boolean),JSON.stringify(addon));assert.equal(addon.unsafe.ok,false);assert.equal(addon.a,'rgb(102, 51, 153)');assert.equal(addon.b,'rgb(17, 119, 68)');assert.equal(addon.c,rgb(tokens.modal));assert.equal(addon.core,rgb(tokens['dock-accent']));assert.equal(addon.bRoot,'rgb(7, 8, 9)');
  const inherited=await page.evaluate(()=>{__theme.addons.mountAddonUi('addon-inherit',{mountId:'inherit',slot:'page.dock',html:'<button class="demo">Default</button>'});__theme.addons.registerAddonStyle('addon-inherit',{styleId:'inherit',cssText:'.demo { background:var(--aperture-accent); }'});return getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('[data-addon-id="addon-inherit"] .demo')).backgroundColor;});assert.equal(inherited,rgb(tokens.accent));
  await page.evaluate(()=>{__theme.addons.closeAddonDialog('addon-c');for(const id of ['addon-a','addon-b','addon-inherit'])__theme.addons.cleanupAddonUi(id);});
  assert.equal(await page.evaluate(()=>document.querySelectorAll('style[data-addon-id]').length),0);assert.equal(await page.evaluate(()=>Object.keys(__theme.styles.getStyleRegistrySnapshot()).filter(k=>k.startsWith('addon-ui:')).length),0);
  await page.evaluate(()=>__theme.modal.closeModal());
  const dock=page.locator('#aperture-example-aperture_example-ui').getByRole('button',{name:'Open settings'});await dock.hover();assert.equal(await dock.evaluate(n=>getComputedStyle(n).backgroundColor),rgb(tokens['dock-accent-hover']));await page.mouse.down();assert.equal(await dock.evaluate(n=>getComputedStyle(n).backgroundColor),rgb(tokens['dock-accent-active']));await page.mouse.up();await page.evaluate(()=>__theme.modal.closeModal());
  await page.locator('#aperture-example-aperture_example-ui').getByRole('button',{name:'Open settings'}).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>__theme.state.stateManager.get('shadowRoot').querySelector('#tag-config-modal').style.display==='block');await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>{const sr=__theme.state.stateManager.get('shadowRoot');return getComputedStyle(sr.activeElement).outlineStyle;});assert.equal(focus,'solid');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>__theme.state.stateManager.get('shadowRoot').querySelector('#tag-config-modal').style.display),'none');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>__theme.modal.openModal());const mobile=await page.evaluate(()=>{const sr=__theme.state.stateManager.get('shadowRoot');return {overflow:sr.querySelector('.modal-content').getBoundingClientRect().width>innerWidth,nav:sr.querySelector('#settings-nav').getBoundingClientRect().width};});assert.equal(mobile.overflow,false);assert(mobile.nav>0);
  const readonly=await page.evaluate(()=>{__theme.readiness.publishStorageReadiness({state:'degraded-readonly',reason:'theme-test'});return __theme.state.stateManager.get('shadowRoot').querySelector('input[type=number]').disabled;});assert.equal(readonly,true);
  await page.evaluate(async()=>{__theme.styles.clearAllStyles();__theme.ui.initUiPhaseIfApplicable();await __theme.modal.openModal();});assert.equal(await page.evaluate(()=>getComputedStyle(__theme.state.stateManager.get('shadowRoot').querySelector('.modal-content')).backgroundColor),rgb(tokens.modal));assert.equal(await page.evaluate(()=>document.querySelectorAll('style[data-style-id^="ui-theme:"]').length),1);
  await page.screenshot({path:evidencePath('theme/'+theme+'-mobile.png')});
  await page.evaluate(()=>{__theme.resources.resourceManager.cleanupAll();__theme.styles.clearAllStyles();});assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-aperture-ui-owner]').length),0);assert.deepEqual(errors,[]);
  fs.writeFileSync(evidencePath('theme/'+theme+'-browser.json'),JSON.stringify({theme,core,presentation,addon,mobile,errors,managerInstalled:false,fixture:'Actual original main/UI + original add-on UI host; add-on command emitter stubbed (phase 5)',checks:['settings change committed','dialogs and toast','owned Shadow/document inheritance and separate overrides','unsafe/sibling CSS isolation','unregister cleanup','focus/Escape/responsive/read-only/reduced motion','host styles unchanged','resource teardown']},null,2)+'\n');
 }finally{await browser.close();}
});

test('standalone example CSS keeps authored fallbacks without automatic core inheritance',async()=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();await page.setContent('<div class="aperture-example-panel">Standalone styles</div>');await page.addStyleTag({content:fs.readFileSync(path.join(ROOT,'addons/example-addon/src/ui/example.css'),'utf8')});const value=await page.evaluate(()=>{const n=document.querySelector('.aperture-example-panel');return {color:getComputedStyle(n).color,token:getComputedStyle(n).getPropertyValue('--aperture-accent'),core:document.querySelector('[data-aperture-ui-owner]')};});assert.deepEqual(value,{color:'rgb(245, 247, 251)',token:'',core:null});}finally{await browser.close();}});

test('project layer base clears site overlays and orders core, add-on and fallback UI',async()=>{const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:1200,height:850}});await page.route('http://localhost/**',route=>route.fulfill({contentType:'text/html',body:'<div id="site-overlay" style="position:fixed;inset:0;z-index:50000;background:rgba(0,0,0,.1)">Site overlay</div>'}));await page.addInitScript(()=>{globalThis.GM={info:{scriptHandler:'Chromium stand-in'},getValue:async(k,f)=>{const v=localStorage.getItem(k);return v===null?f:JSON.parse(v)},setValue:async(k,v)=>localStorage.setItem(k,JSON.stringify(v)),deleteValue:async k=>localStorage.removeItem(k)};});const built=await bundle('default',{zIndex:100000});await page.goto('http://localhost/');await page.addScriptTag({content:built.code});await page.evaluate(()=>{const root=__theme.state.stateManager.get('shadowRoot');__theme.state.stateManager.set('shadowRoot',null);__theme.toast.showToast('Fallback',10000);__theme.state.stateManager.set('shadowRoot',root);});assert.equal(await page.locator('.aperture-toast-container').evaluate(node=>getComputedStyle(node).zIndex),'103210');await page.evaluate(async()=>{await __theme.main.startRuntime();await __theme.modal.openModal();__theme.modal.closeModal();});const host=page.locator('#aperture-example-aperture_example-ui');const dock=host.getByRole('button',{name:'Open settings'});assert.equal(await dock.evaluate(node=>getComputedStyle(node.closest('#aperture-page-dock')).zIndex),'100020');await dock.click();assert.equal(await host.locator('#tag-config-modal').evaluate(node=>getComputedStyle(node).zIndex),'103000');await page.evaluate(()=>{__theme.dialog.openConfirmDialog({title:'Layers'});__theme.addons.openAddonDialog('layers-addon',{dialogId:'layers',title:'Add-on layers',html:'<p>Layered</p>'});});assert.equal(await host.locator('.config-dialog-backdrop').evaluate(node=>getComputedStyle(node).zIndex),'103100');assert.equal(await page.locator('.aperture-addon-dialog-overlay').evaluate(node=>getComputedStyle(node.parentElement).zIndex),'103120');await page.evaluate(()=>{__theme.addons.closeAddonDialog('layers-addon');__theme.resources.resourceManager.cleanupAll();__theme.styles.clearAllStyles();});assert.equal(await page.locator('[data-aperture-ui-owner]').count(),0);assert.equal(await page.locator('#site-overlay').count(),1);}finally{await browser.close();}});


test('dock slides continuously after settings styles load; add-on panels retain distinct surfaces', async () => {
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage({reducedMotion:'no-preference'});
  await page.route('http://localhost/**', route => route.fulfill({contentType:'text/html', body:'<main>Fixture</main>'}));
  await page.addInitScript(()=>{globalThis.GM={info:{scriptHandler:'Chromium stand-in'},getValue:async(k,f)=>{const v=localStorage.getItem(k);return v===null?f:JSON.parse(v)},setValue:async(k,v)=>localStorage.setItem(k,JSON.stringify(v)),deleteValue:async k=>localStorage.removeItem(k)};});
  await page.goto('http://localhost/');
  await page.addScriptTag({content:(await bundle()).code});
  await page.evaluate(async () => { await __theme.main.startRuntime(); await __theme.modal.openModal(); __theme.modal.closeModal(); document.activeElement?.blur(); const sr=__theme.state.stateManager.get('shadowRoot'); sr.activeElement?.blur(); });
  const result = await page.evaluate(async () => {
   const sr=__theme.state.stateManager.get('shadowRoot'), dock=sr.querySelector('#aperture-page-dock'), button=sr.querySelector('#tag-config-button');
   const x=()=>new DOMMatrixReadOnly(getComputedStyle(button).transform).m41;
   dock.classList.remove('is-collapsed'); getComputedStyle(button).transform;
   await new Promise(resolve=>setTimeout(resolve,300));
   dock.classList.add('is-collapsed'); getComputedStyle(button).transform;
   await new Promise(resolve=>setTimeout(resolve,80)); const middle=x();
   await new Promise(resolve=>setTimeout(resolve,300)); const end=x();
   dock.classList.remove('is-collapsed'); getComputedStyle(button).transform;
   await new Promise(resolve=>setTimeout(resolve,80)); const returning=x();
   const wrapper=sr.querySelector('#global-settings-container');
   const backgrounds={}; for (const variant of ['installed','running','pinned']) { const node=__theme.badge.createBadge(wrapper,variant,variant); backgrounds[variant]=getComputedStyle(node).backgroundColor; }
   const note=document.createElement('div');note.className='tag-priority-note';wrapper.append(note);
   const panel=document.createElement('div');panel.className='addins-panel-settings';wrapper.append(panel);
   return {middle,end,returning,backgrounds,note:{padding:getComputedStyle(note).padding,background:getComputedStyle(note).backgroundColor},panel:getComputedStyle(panel).backgroundColor};
  });
  assert(result.end < -10, JSON.stringify(result));
  assert(result.middle < 0 && result.middle > result.end, JSON.stringify(result));
  assert(result.returning > result.end && result.returning < 0, JSON.stringify(result));
  assert.equal(new Set(Object.values(result.backgrounds)).size,3);
  assert.equal(result.note.padding,'6px 8px');assert.notEqual(result.note.background,'rgba(0, 0, 0, 0)');assert.notEqual(result.panel,'rgb(32, 36, 42)');
 } finally { await browser.close(); }
});
