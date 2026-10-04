const { evidencePath } = require('./evidence-path.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ROOT, bundle } = require('./core-contract-helpers.cjs');

test('Chromium: two independently bundled applications retain native observer/style/owner/queue/diagnostic/bridge isolation', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors=[];page.on('pageerror', error=>errors.push(error.message));
    await page.route('https://example.org/**', route => route.fulfill({contentType:'text/html',body:'<main id="alpha"></main><main id="beta"></main>'}));
    await page.goto('https://example.org/articles/one');
    for (const id of ['alpha-app','beta-app']) {
      await page.addScriptTag({content:bundle({id}).code});
      await page.evaluate(id=>{
        const app=globalThis.__apertureCore;
        const state=app.state.createStateManager({value:1,shadowRoot:null,isArticle:true});
        app.inputs.configureCoreContext({id,stateManager:state,getConfig:()=>({enabled:true}),pageDefinitions:{isArticle:{hostIncludes:['example.org']}}});
        app.fixtureState=state;globalThis[id]=app;
      },id);
    }
    const result=await page.evaluate(async()=>{
      const alpha=globalThis['alpha-app'],beta=globalThis['beta-app'];
      const counts={alpha:0,beta:0};
      const nativeObservers=[];const NativeObserver=globalThis.MutationObserver;
      globalThis.MutationObserver=class extends NativeObserver{constructor(...args){super(...args);nativeObservers.push(this);}};
      for(const [name,app,color] of [['alpha',alpha,'rgb(255, 0, 0)'],['beta',beta,'rgb(0, 0, 255)']]){
        const mount=document.getElementById(name),shadow=mount.attachShadow({mode:'open'}),button=document.createElement('button');button.textContent=name;shadow.append(button);
        app.fixtureState.set('shadowRoot',shadow);
        app.styles.acquireStyle('same-style',`button { color: ${color}; }`,'shadow','shared-owner');
        app.listeners.addListener('same-listener',button,'click',()=>app.fixtureState.set('value',app.fixtureState.get('value')+1),undefined,'shared-owner');
        app.observer.setObserverProfilingEnabled(true);
        app.observer.addObserverCallback('same-observer',()=>counts[name]++,{ownerId:'shared-owner',filter:mutations=>mutations.some(mutation=>mutation.target===mount||mount.contains(mutation.target))});
        app.fixtureQueue=app.queue.createTaskQueue({name:'Same Queue',ownerId:'shared-owner',delay:10});app.fixtureQueue.pause();
        app.fixturePending=app.fixtureQueue.add('same-key',()=>app.fixtureState.set('value',app.fixtureState.get('value')+10));
        app.fixtureBridge=app.bridge.requestPageBridge({requestEvent:`${name}:request`,resultEvent:`${name}:result`,ownerId:'shared-owner',timeoutMs:1000});
        app.fixtureStatusCount=0;app.bridge.subscribePageBridgeEvent(`${name}:status`,()=>app.fixtureStatusCount++,{ownerId:'shared-owner'});
        app.fixtureButton=button;
      }
      for(const name of ['alpha','beta']){const mount=document.getElementById(name);mount.append(document.createElement('span'),document.createElement('i'));}
      await new Promise(resolve=>setTimeout(resolve,0));
      const colors=[getComputedStyle(alpha.fixtureButton).color,getComputedStyle(beta.fixtureButton).color];
      const batchesBefore={...counts};
      alpha.health.reportFeatureFailure('Article','only alpha fails');
      const diagnosticIsolation=beta.health.getFeatureStatus('Article').status==='unknown';
      const profileKeysIsolated=localStorage.getItem('alpha-app.observerProfile')==='1'&&localStorage.getItem('beta-app.observerProfile')==='1';
      alpha.resources.releaseOwner('shared-owner');
      const alphaCancelled=(await alpha.fixturePending).status==='cancelled';
      const bridgeCancelled=(await alpha.fixtureBridge).reason==='bridge_aborted';
      alpha.fixtureButton.click();beta.fixtureButton.click();
      alpha.bridge.dispatchPageBridgeEvent('alpha:result',{wrongApp:true});
      beta.bridge.dispatchPageBridgeEvent('beta:result',{rightApp:true});
      const betaResponse=await beta.fixtureBridge;
      beta.bridge.dispatchPageBridgeEvent('beta:status');alpha.bridge.dispatchPageBridgeEvent('alpha:status');
      beta.fixtureQueue.resume();await beta.fixturePending;
      document.getElementById('alpha').append(document.createElement('b'));document.getElementById('beta').append(document.createElement('b'));
      await new Promise(resolve=>setTimeout(resolve,0));
      const checks={nativeObservers:nativeObservers.length,colors,batchesBefore,counts,diagnosticIsolation,profileKeysIsolated,alphaCancelled,bridgeCancelled,
        alphaResources:alpha.resources.getResourceSnapshot().totalResources,betaResources:beta.resources.getResourceSnapshot().totalResources,
        alphaQueueCount:alpha.queue.getTaskQueueDiagnostics().queueCount,betaQueueCount:beta.queue.getTaskQueueDiagnostics().queueCount,
        alphaValue:alpha.fixtureState.get('value'),betaValue:beta.fixtureState.get('value'),betaResponse,alphaStatusCount:alpha.fixtureStatusCount,betaStatusCount:beta.fixtureStatusCount,
        alphaStyles:Object.keys(alpha.styles.getStyleRegistrySnapshot()).length,betaStyles:Object.keys(beta.styles.getStyleRegistrySnapshot()).length};
      beta.resources.releaseOwner('shared-owner');alpha.observer.setObserverProfilingEnabled(false);beta.observer.setObserverProfilingEnabled(false);
      return checks;
    });
    assert.equal(result.nativeObservers,2);assert.deepEqual(result.colors,['rgb(255, 0, 0)','rgb(0, 0, 255)']);
    assert.deepEqual(result.batchesBefore,{alpha:1,beta:1});assert.deepEqual(result.counts,{alpha:1,beta:2});
    assert.equal(result.diagnosticIsolation,true);assert.equal(result.profileKeysIsolated,true);assert.equal(result.alphaCancelled,true);assert.equal(result.bridgeCancelled,true);
    assert.equal(result.alphaResources,0);assert.ok(result.betaResources>0);assert.equal(result.alphaQueueCount,0);assert.equal(result.betaQueueCount,1);
    assert.equal(result.alphaValue,1);assert.equal(result.betaValue,12);assert.equal(result.betaResponse.detail.rightApp,true);
    assert.equal(result.alphaStatusCount,0);assert.equal(result.betaStatusCount,1);assert.equal(result.alphaStyles,0);assert.equal(result.betaStyles,1);assert.deepEqual(errors,[]);
    fs.writeFileSync(evidencePath('core-contract/browser-evidence.json'),JSON.stringify({checkedAt:new Date().toISOString(),browser:'Chromium (headless)',managerInstalled:false,...result},null,2)+'\n');
  }finally{await browser.close();}
});
