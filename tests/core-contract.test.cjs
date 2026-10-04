const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT, bundle, environment, plain, microtasks } = require('./core-contract-helpers.cjs');

test('core exposes its declared exports and keeps UI/services outside the primitive graph', async () => {
  const env = environment();
  try {
    const contract = require('./core-contract-exports.json');
    assert.deepEqual(Object.keys(env.api).sort(), Object.keys(contract).sort());
    for (const [name, exports] of Object.entries(contract)) assert.deepEqual(Object.keys(env.api[name]).sort(), exports, name);
    for (const input of Object.keys(bundle().metafile.inputs)) {
      const relative = input.replace(/\\/g, '/');
      assert.doesNotMatch(relative, /src\/(?:config(?:\.js|\/)|ui\/|services\/|features\/)|addons\//);
    }
  } finally { await env.close(); }
});

{
  const prefix = 'Aperture core';
  test(`${prefix}: feature lifecycle API, applicability, failure/retry and serialized cancellation`, async () => {
    const env = environment(); const { api, config } = env;
    try {
      config.enabled = true;
      let enabled = 0, disabled = 0, fail = true, received;
      const feature = api.factory.createFeature('Preserved Article', { id: 'article', configPath: 'enabled', isApplicable: ({ config: supplied }) => supplied.enabled,
        enable(context) { received = context; if (fail) throw new Error('fixture failure token=hidden'); enabled++; }, disable() { disabled++; } });
      assert.deepEqual(Object.keys(feature).sort(), ['id','featureKey','name','bootstrapMode','_declaredBootstrapMode','pageScopes','settingsUi','enable','disable','toggle','sync','isEnabled','isApplicable','reportError'].sort());
      await assert.rejects(feature.enable({ reason: 'retry', routeGeneration: 3, correlationId: 'article-3' }), /fixture failure/);
      assert.equal(api.health.getFeatureStatus('Preserved Article').status, 'failing');
      assert.doesNotMatch(api.health.getFeatureStatus('Preserved Article').details, /hidden/);
      fail = false; await feature.sync(); assert.equal(enabled, 1);
      await feature.disable(); assert.equal(disabled, 1);
      config.enabled = false; assert.equal(feature.isEnabled(), false); assert.equal(await feature.enable(), false);
      config.enabled = true; await feature.enable({ reason: 'route-change', routeGeneration: 9 }); assert.equal(received.routeGeneration, 9); assert.equal(received.reason, 'route-change');
      let release; const slow = api.factory.createFeature('Slow Article', { enable(context) { return new Promise(resolve => { release = resolve; context.signal.addEventListener('abort', resolve, { once: true }); }); }, disable() { disabled++; } });
      const pending = slow.enable(); const rejected = assert.rejects(pending, /abort/i); await microtasks();
      const stop = slow.disable(); await rejected; await stop; release();
      assert.equal(api.health.getFeatureStatus('Slow Article').status, 'disabled');
    } finally { await env.close(); }
  });
  test(`${prefix}: lifecycle timeout is 15 seconds and route cancellation rejects stale commits`, async () => {
    const env = environment();
    try {
      let context;
      const hung = env.api.factory.createFeature('Timeout Article', { enable(next) { context = next; return new Promise(() => {}); } });
      const pending = hung.enable(); const rejection = assert.rejects(pending, /timeout/i);
      await microtasks(); await env.clock.tick(14999); assert.equal(context.signal.aborted, false);
      await env.clock.tick(1); await rejection; assert.equal(context.signal.aborted, true);
      const controller = new AbortController(); let committed = false;
      const stale = env.api.factory.createFeature('Stale Article', { async enable(next) { controller.abort(); await Promise.resolve(); if (!next.signal.aborted) committed = true; } });
      await assert.rejects(stale.enable({ signal: controller.signal, routeGeneration: 4 }), /abort/i);
      assert.equal(committed, false);
    } finally { await env.close(); }
  });
  test(`${prefix}: owned resources isolate cleanup failures, wildcards and duplicate IDs`, async () => {
    const env = environment();
    try {
      const { resources, health } = env.api; const released = [];
      const owner = resources.createResourceOwner('article-owner'); owner.register('article:a', () => released.push('a'));
      owner.register('article:b', () => { throw new Error('cleanup failure'); });
      resources.createResourceOwner('other-owner').register('other:c', () => released.push('c'));
      assert.throws(() => owner.register('article:a', () => {}), /already registered/);
      assert.equal(resources.releaseOwner('article-owner').released, 2); assert.deepEqual(released, ['a']);
      // getOwner returns a release handle even for an empty nonempty ID.
      assert.deepEqual(plain(resources.releaseOwner('article-owner')), { ownerId: 'article-owner', released: 0, alreadyReleased: false });
      assert.equal(resources.getResourceSnapshot().totalResources, 1);
      assert.ok(health.getHealthEvents().some(event => event.code === 'RESOURCE_CLEANUP_FAILED'));
      resources.resourceManager.cleanupAll('other:*'); assert.equal(resources.getResourceSnapshot().totalResources, 0);
      assert.equal(resources.assertNoResourceLeaks('article-owner'), true);
    } finally { await env.close(); }
  });
  test(`${prefix}: style reference counts, document/shadow/explicit targets, and owner release`, async () => {
    const env = environment();
    try {
      const { styles, resources } = env.api; const shadow = env.window.document.createElement('div').attachShadow({ mode: 'open' }); env.state.set('shadowRoot', shadow);
      const first = styles.acquireStyle('article-style', '.article { color: red; }');
      assert.equal(first.parentNode, env.window.document.head); assert.equal(styles.acquireStyle('article-style', '.article { color: red; }'), first);
      assert.equal(styles.getStyleRegistrySnapshot()['article-style'].refs, 2);
      styles.removeStyle('article-style'); assert.equal(first.parentNode, env.window.document.head);
      const changed = styles.acquireStyle('article-style', '.article { color: blue; }', 'shadow'); assert.equal(changed.parentNode, shadow); assert.equal(first.parentNode, null);
      styles.removeStyle('article-style', { force: true }); assert.equal(changed.parentNode, null);
      const target = env.window.document.createElement('section'); env.window.document.body.append(target);
      const explicit = styles.acquireStyle('owned-style', 'section { display: block; }', target, 'style-owner'); assert.equal(explicit.parentNode, target);
      resources.releaseOwner('style-owner'); assert.equal(explicit.parentNode, null); assert.deepEqual(plain(styles.getStyleRegistrySnapshot()), {});
      env.state.set('shadowRoot', null); assert.equal(styles.acquireStyle('missing-shadow', '', 'shadow'), null);
    } finally { await env.close(); }
  });
  test(`${prefix}: debounce preserves last receiver/arguments; queue cancellation remains callable`, async () => {
    const env = environment();
    try {
      const calls = []; const receiver = { value: 7 }; const task = function (...args) { calls.push([this.value, ...args]); };
      const standalone = env.api.debounce.createDebouncedTask(task, 30);
      standalone.call(receiver, 'first'); standalone.call(receiver, 'last', 2); await env.clock.tick(29); assert.equal(calls.length, 0);
      await env.clock.tick(1); assert.deepEqual(calls, [[7, 'last', 2]]);
      const queued = env.api.queue.createDebouncedTask(task, 30); queued.call(receiver, 'cancelled'); queued.cancel(); queued.cancel(); await env.clock.tick(31); assert.equal(calls.length, 1);
      assert.equal(typeof standalone.cancel, 'function');
      { standalone.call(receiver, 'cancelled'); standalone.cancel(); await env.clock.tick(31); assert.equal(calls.length, 1); }
    } finally { await env.close(); }
  });
  test(`${prefix}: StateManager retains parent notifications, strict paths, exception and snapshot semantics`, async () => {
    const env = environment();
    try {
      const initial = { article: { title: 'one' } }; const state = env.api.state.createStateManager(initial); initial.article.title = 'mutated'; assert.equal(state.get('article.title'), 'one');
      const events = []; const offParent = state.subscribe('article', value => events.push(['parent', value.title])); state.subscribe('article.title', value => events.push(['child', value]));
      state.set('article.title', 'two'); assert.deepEqual(events, [['parent','two'],['child','two']]); events.length = 0;
      state.set('article', { title: 'three' }); assert.deepEqual(events, [['parent','three']]);
      offParent(); state.set('article.title', 'four'); assert.equal(events.length, 2); assert.equal(state.set('unknown', 1), false);
      const strict = env.api.state.createStateManager({ known: 1 }, { throwUnknown: true }); assert.throws(() => strict.set('bad', 1), /unknown/);
      const throwing = env.api.state.createStateManager({ x: 0 }); throwing.subscribe('x', () => { throw new Error('subscriber'); }); assert.throws(() => throwing.set('x', 1), /subscriber/); assert.equal(throwing.get('x'), 1);
      const node = env.window.document.createElement('div'); const circular = {}; circular.self = circular; state.set('article', { node, circular }); assert.deepEqual(plain(state.getState()), { article: { node: null, circular: { self: null } } });
      const known = state.getKnownPaths(); known.add('external'); assert.equal(state.getKnownPaths().has('external'), false);
    } finally { await env.close(); }
  });
  test(`${prefix}: health events retain caps, redaction, deduplication, subscriber/provider isolation`, async () => {
    const env = environment();
    try {
      const { health } = env.api; let notifications = 0; const off = health.subscribeFeatureHealth(() => notifications++);
      health.subscribeFeatureHealth(() => { throw new Error('subscriber cannot break health'); });
      for (let i = 0; i < 3; i++) health.recordHealthEvent({ code: 'FEATURE_TEST', ownerId: 'article', message: 'token=hidden <b>html</b>', details: { secret: 'password=hidden', html: '<div>unsafe</div>' } });
      assert.equal(health.getHealthEvents().length, 1); assert.equal(health.getHealthEvents()[0].count, 3); assert.equal(notifications, 3);
      const copied = health.getHealthEvents(); copied[0].details.secret = 'tampered'; assert.doesNotMatch(health.getHealthEvents()[0].details.secret, /hidden|tampered/);
      for (let i = 0; i < 110; i++) health.recordHealthEvent({ code: `FEATURE_${i}`, message: 'bounded' }); assert.equal(health.getHealthEvents().length, 100);
      for (let i = 0; i < 15; i++) health.pushFeatureError('article', 'error ' + i); assert.equal(health.getFeatureErrors('article').length, 10);
      for (let i = 0; i < 25; i++) health.pushRuntimeError('error ' + i); assert.equal(health.getRuntimeErrors().length, 20);
      const providerValue = { nested: { x: 1 } }; const offProvider = health.registerDiagnosticsProvider('article-provider', () => providerValue); health.registerDiagnosticsProvider('broken', () => { throw new Error('provider'); });
      const diagnostics = health.getHealthDiagnostics(); diagnostics.snapshots['article-provider'].nested.x = 2; assert.equal(providerValue.nested.x, 1); assert.equal(diagnostics.snapshots.broken.unavailable, true);
      offProvider(); off(); assert.equal(health.getHealthDiagnostics().snapshots['article-provider'], undefined);
    } finally { await env.close(); }
  });
  test(`${prefix}: development logger retains levels, grouped data and Error stacks`, async () => {
    const env = environment({ debug: true });
    try {
      const error = new Error('development failure'); env.api.logger.debugLog('Article', 'message', { level: 'error', data: error });
      assert.deepEqual(env.logs.map(entry => entry.level), ['groupCollapsed','error','error','groupEnd']); assert.equal(env.logs[2].args[0], error); assert.match(env.logs[2].args[0].stack, /development failure/);
      env.logs.length = 0; env.api.logger.debugLog('Article','warning','warn'); assert.equal(env.logs[1].level, 'warn');
      env.logs.length = 0; env.api.logger.debugLog('Article','fallback',{level:'missing',value:1}); assert.equal(env.logs[1].level, 'log'); assert.equal(env.logs[2].args[0].value, 1);
    } finally { await env.close(); }
  });
  test(`${prefix}: frame budget retains min-chunk, elapsed time, RAF/fallback and cancellation`, async () => {
    const env = environment();
    try {
      const budget = env.api.frame.createFrameBudget({ budgetMs: 4, minChunk: 2 }); env.setTime(10); assert.equal(budget.checkpoint(), null);
      const yielded = budget.checkpoint(); assert.equal(typeof yielded.then, 'function'); await env.clock.tick(0); assert.equal(await yielded, true);
      assert.equal(budget.checkpoint(), null);
      const seen = []; const running = env.api.frame.runFrameBudgeted([1,2,3,4], value => { seen.push(value); }, { startOnNextFrame: false, shouldContinue: () => seen.length < 2 });
      assert.deepEqual(plain(await running), { completed: false, processed: 2 }); assert.deepEqual(seen, [1,2]);
      delete env.sandbox.requestAnimationFrame; const next = env.api.frame.nextFrame(); await env.clock.tick(0); await next;
      const empty = await env.api.frame.runFrameBudgeted([], () => assert.fail('empty work')); assert.deepEqual(plain(empty), { completed: true, processed: 0 });
    } finally { await env.close(); }
  });
  test(`${prefix}: native observer batching, filters, deduplication, failures and owner removal`, async () => {
    const env = environment({ fakeClock: false });
    try {
      const { observer, resources, health } = env.api; const batches = [], filtered = [];
      let instances = 0; const Native = env.sandbox.MutationObserver; env.sandbox.MutationObserver = class extends Native { constructor(...args) { super(...args); instances++; } };
      observer.setObserverProfilingEnabled(true);
      observer.addObserverCallback('article-obs', mutations => batches.push(mutations.length), { ownerId: 'article-observer' }); observer.addObserverCallback('article-obs', () => assert.fail('duplicate must not replace'));
      observer.addObserverCallback('filtered', () => filtered.push(1), { filter: () => false });
      observer.addObserverCallback('bad-filter', () => assert.fail('failed filter'), { filter: () => { throw new Error('filter error'); }, healthId: 'filter-health' });
      observer.addObserverCallback('bad-callback', () => { throw new Error('callback error'); }, { healthId: 'callback-health' });
      env.window.document.body.append(env.window.document.createElement('div'), env.window.document.createElement('span'));
      await env.window.happyDOM.waitUntilComplete(); assert.equal(instances, 1); assert.equal(batches.length, 1); assert.ok(batches[0] >= 1); assert.equal(filtered.length, 0);
      assert.equal(health.getFeatureStatus('filter-health').status, 'failing'); assert.equal(health.getFeatureStatus('callback-health').status, 'failing'); assert.equal(observer.getObserverProfileSnapshot().ticks, 1);
      resources.releaseOwner('article-observer'); env.window.document.body.append(env.window.document.createElement('p')); await env.window.happyDOM.waitUntilComplete(); assert.equal(batches.length, 1);
      observer.removeAllObserverCallbacks(); observer.addObserverCallback('restart', () => {}); assert.equal(instances, 2); observer.removeObserverCallback('restart');
    } finally { await env.close(); }
  });
  test(`${prefix}: page bridge injection/marker, timeout, result and dispatch failure cleanup`, async () => {
    const env = environment();
    try {
      const { bridge } = env.api; const marker = 'articleBridge'; assert.equal(bridge.ensurePageBridge({ marker, scriptContent: 'window.articleFixture = true;' }), true); assert.equal(env.window.document.documentElement.dataset[marker], '1');
      assert.equal(env.window.document.querySelectorAll('script').length, 0); assert.equal(bridge.ensurePageBridge({ marker, scriptContent: 'invalid' }), true);
      const timed = bridge.requestPageBridge({ requestEvent: 'article:request', resultEvent: 'article:result', timeoutMs: 50 }); await env.clock.tick(50); assert.deepEqual(plain(await timed), {received:false, reason:'bridge_timeout', detail:{}});
      const responded = bridge.requestPageBridge({ requestEvent: 'article:request', resultEvent: 'article:result', timeoutMs: 50 }); bridge.dispatchPageBridgeEvent('article:result', { value: 7 }); assert.equal((await responded).detail.value, 7);
      // Deliberately unauthenticated: page-owned code can forge a response.
      const spoofed = bridge.requestPageBridge({requestEvent:'article:request',resultEvent:'article:result'}); env.window.dispatchEvent(new env.window.CustomEvent('article:result',{detail:{spoofed:true}})); assert.equal((await spoofed).detail.spoofed, true);
      const originalDispatch = env.window.dispatchEvent; env.window.dispatchEvent = () => { throw new Error('dispatch rejected'); };
      const failed = await bridge.requestPageBridge({ requestEvent:'article:request',resultEvent:'article:result' }); assert.equal(failed.reason, 'dispatch rejected'); env.window.dispatchEvent = originalDispatch;
      let calls = 0; const off = bridge.subscribePageBridgeEvent('article:status', () => calls++); bridge.dispatchPageBridgeEvent('article:status'); off(); off(); bridge.dispatchPageBridgeEvent('article:status'); assert.equal(calls,1);
    } finally { await env.close(); }
  });
  test(`${prefix}: task queue duplicate/overflow policies, sequential fairness, pause/resume and owned disposal`, async () => {
    const env = environment();
    try {
      const { queue, resources } = env.api;
      for (const policy of ['drop-new','drop-old','replace-pending']) {
        const q=queue.createTaskQueue({name:`duplicate-${policy}`,duplicatePolicy:policy,delay:1});q.pause();
        const first=q.add('same',()=>1), second=q.add('same',()=>2); q.resume();
        await env.clock.tick(1);await microtasks();
        const values=await Promise.all([first,second]); assert.equal(values.filter(value=>value.status==='completed').length,1);
        assert.equal(values.find(value=>value.status==='completed').value,policy==='drop-new'?1:2);await q.dispose();
      }
      for (const policy of ['drop-oldest','drop-new','reject']) {
        const q=queue.createTaskQueue({name:`overflow-${policy}`,overflowPolicy:policy,maxPending:1,delay:1});q.pause();
        const first=q.add('first',()=>1), second=q.add('second',()=>2); const rejected=policy==='reject'?assert.rejects(second,/full/):null;
        q.resume();await env.clock.tick(1);await microtasks(); const value=await first;
        if(rejected)await rejected;else{const next=await second;assert.equal(next.status,policy==='drop-new'?'cancelled':'completed');}
        assert.equal(value.status,policy==='drop-oldest'?'cancelled':'completed');await q.dispose();
      }
      const q=queue.createTaskQueue({name:'sequential',ownerId:'queue-owner',delay:2});q.pause();const order=[];
      const tasks=[1,2,3].map(value=>q.add(String(value),async()=>{order.push(value);await Promise.resolve();return value;}));
      await env.clock.tick(2); assert.deepEqual(order,[]);q.resume();
      for(let i=0;i<3;i++){await env.clock.tick(2);await microtasks();}
      assert.deepEqual(order,[1,2,3]);assert.equal((await Promise.all(tasks)).every(value=>value.status==='completed'),true);await q.whenIdle();
      const stale=q.add('stale',()=>assert.fail('stale work'),0);q.setGeneration(2);assert.equal((await stale).status,'cancelled');
      const pending=q.add('owned',()=>assert.fail('disposed work'));resources.releaseOwner('queue-owner');assert.equal((await pending).status,'cancelled');assert.equal(q.snapshot().disposed,true);assert.equal((await q.drain()).status,'disposed');
      assert.equal(queue.getTaskQueueDiagnostics().queueCount,0);
    }finally{await env.close();}
  });
  test(`${prefix}: task queue running cancellation, task timeout and failure diagnostics`, async () => {
    const env=environment();
    try{
      const q=env.api.queue.createTaskQueue({name:'running',delay:1});
      const running=q.add('abort',()=>new Promise(()=>{}));await env.clock.tick(1);await microtasks();assert.equal(q.cancelRunning('cancelled by fixture'),true);
      assert.equal((await running).status,'cancelled');await microtasks();
      const timed=q.add('timeout',()=>new Promise(()=>{}),0,20);await env.clock.tick(1);await microtasks();await env.clock.tick(20);assert.equal((await timed).status,'cancelled');await microtasks();
      const failure=q.add('failure',()=>{throw new Error('queue failure');});const rejected=assert.rejects(failure,/queue failure/);await env.clock.tick(1);await microtasks();await rejected;
      assert.equal(q.snapshot().lastFailure.key,'failure');assert.equal(env.api.health.getFeatureStatus('running').status,'degraded');await q.dispose();
    }finally{await env.close();}
  });
  test(`${prefix}: factory normalizers, explicit lifecycle context and global error listener reset`, async()=>{
    const env=environment();
    try{
      const {factory,health,listeners,resources}=env.api;
      assert.equal(factory.resolveFeatureId('Article Name','',''), 'article-name');assert.equal(factory.resolveFeatureId('Name',' Explicit ID '),'explicit-id');
      assert.equal(factory.normalizeFeatureBootstrapMode('fast'),'fast');assert.equal(factory.normalizeFeatureBootstrapMode('unknown'),'waitForBody');
      const controller=new AbortController();const context=factory.createLifecycleContext('article','enable',{generation:2,routeGeneration:3,reason:'retry',routeSignal:controller.signal,correlationId:'article-3'});
      assert.equal(context.generation,2);assert.equal(context.routeGeneration,3);assert.equal(context.featureId,'article');assert.equal(context.reason,'retry');assert.equal(context.correlationId,'article-3');controller.abort('stale route');assert.equal(context.signal.aborted,true);
      factory.initGlobalErrorListeners();factory.initGlobalErrorListeners();assert.equal(resources.getResourceSnapshot().totalResources,2);
      env.window.dispatchEvent(new env.window.ErrorEvent('error',{error:new Error('window failure')}));const rejection=new env.window.Event('unhandledrejection');rejection.reason=new Error('promise failure');env.window.dispatchEvent(rejection);
      assert.equal(health.getRuntimeErrors().length,2);listeners.removeAllListeners();factory.resetGlobalErrorListeners();factory.initGlobalErrorListeners();assert.equal(resources.getResourceSnapshot().totalResources,2);
    }finally{await env.close();}
  });
  test(`${prefix}: listener registrars retain unique instances, returned removal and idempotent disposal`,async()=>{
    const env=environment();
    try{
      const target=env.window.document.createElement('button');let clicks=0;const first=env.api.listeners.createRegistrar('article'),second=env.api.listeners.createRegistrar('article');
      const remove=first.reg(target,'click',()=>clicks++);second.reg(target,'click',()=>clicks++);target.click();assert.equal(clicks,2);remove();target.click();assert.equal(clicks,3);first.dispose();second.dispose();second.dispose();target.click();assert.equal(clicks,3);assert.equal(env.api.resources.getResourceSnapshot().totalResources,0);
    }finally{await env.close();}
  });
}

test('styled handlers receive route context, rejected disable releases styles and listener IDs can be reused', async () => {
  {
    const env = environment();
    try {
      let received; const feature = env.api.styled.createStyledFeature('Styled Article', { styleCss: '.article{}', styleId:'article-style', enable(context) { received = context; }, disable() { throw new Error('disable failed'); } });
      await feature.enable({reason:'route-change',routeGeneration:4}); assert.equal(received?.routeGeneration, 4);
      await assert.rejects(feature.disable(), /disable failed/); assert.equal(Boolean(env.api.styles.getStyleRegistrySnapshot()['article-style']), false);
      let clicks=0; const button=env.window.document.createElement('button');
      env.api.listeners.addListener('article-click',button,'click',()=>clicks++,undefined,'article-listener'); env.api.resources.releaseOwner('article-listener');
      env.api.listeners.addListener('article-click',button,'click',()=>clicks++,undefined,'article-listener'); button.click(); assert.equal(clicks, 1);
    } finally { await env.close(); }
  }
});
test('project styled feature uses shared ownership/queue/observer mechanisms and cooperates with route abort', async () => {
  const env = environment({fakeClock:false});
  try {
    const {api}=env; const route=api.route.beginRoute(new URL('https://example.org/articles/one')); api.detection.detectPage(new URL('https://example.org/articles/one'),route); let completed=0, element;
    const feature=api.styled.createStyledFeature('Article Tool',{ configPath:'enabled', isApplicable:({stateManager})=>stateManager.get('isArticle'), styleId:'article-owned',styleOwnerId:'article',styleCss:'.article-tool{color:purple}',
      async enable(context) { element=env.window.document.createElement('button'); element.className='article-tool'; env.window.document.body.append(element);
        const owner=api.resources.createResourceOwner('article'); owner.register('article:element',()=>element.remove());
        api.listeners.addListener('article:click',element,'click',()=>completed++,undefined,'article');
        api.observer.addObserverCallback('article:observer',()=>{}, {ownerId:'article'});
        const queue=api.queue.createTaskQueue({name:'Article Queue',ownerId:'article',delay:0,routeContext:{generation:context.routeGeneration}});
        await queue.add('article-task',async task=>{await new Promise(resolve=>task.signal.addEventListener('abort',resolve,{once:true})); if(!task.signal.aborted)completed++;},{generation:context.routeGeneration,signal:context.signal});
      }, disable() {api.resources.releaseOwner('article');} });
    api.catalog.registerFeature(feature); assert.equal(api.scope.featureMatchesPageScopes({...feature,pageScopes:['isArticle']}),true);
    const pending=feature.enable({signal:route.signal,routeGeneration:route.generation,reason:'route-change'}); const rejected=assert.rejects(pending,/abort/i);
    await new Promise(resolve=>setTimeout(resolve,20));
    const away=api.route.beginRoute(new URL('https://example.org/other/'));api.detection.detectPage(new URL('https://example.org/other/'),away);
    await rejected; await feature.disable({reason:'teardown'});assert.equal(feature.isApplicable(),false);
    assert.equal(completed,0); assert.equal(element.isConnected,false); assert.deepEqual(plain(api.styles.getStyleRegistrySnapshot()),{}); assert.equal(api.resources.getResourceSnapshot().totalResources,0);
    const back=api.route.beginRoute(new URL('https://example.org/articles/two'));api.detection.detectPage(new URL('https://example.org/articles/two'),back);
    const reenabled = feature.enable({signal:back.signal,routeGeneration:back.generation,reason:'route-change'});
    const superseded = assert.rejects(reenabled, /abort/i);
    await new Promise(resolve=>setTimeout(resolve,20));
    await feature.disable({reason:'teardown'}); await superseded;
    assert.equal(api.resources.getResourceSnapshot().totalResources,0);
  } finally {await env.close();}
});
test('missing or failing UI never hides a generic feature failure; context cannot join different applications', async () => {
  const env=environment();
  try {
    const feature=env.api.factory.createFeature('Article Failure',{enable(){throw new Error('failure without UI');}}); await assert.rejects(feature.enable(),/failure without UI/);
    assert.equal(env.api.health.getFeatureStatus('Article Failure').status,'failing');
    env.api.inputs.configureCoreContext({notify(){throw new Error('UI unavailable');}}); feature.reportError(new Error('runtime error')); assert.equal(env.api.health.getFeatureStatus('Article Failure').status,'failing');
    assert.throws(()=>env.api.inputs.configureCoreContext({id:'other-app'}),/cannot be shared/);
    assert.throws(()=>env.api.inputs.configureCoreContext({unknown:true}),/Unknown core input/);
    assert.throws(()=>env.api.inputs.configureCoreContext({getConfig:{}}),/must be a function/);
  } finally {await env.close();}
});
test('page bridge optional abort/owner inputs clean pending requests and subscriptions', async () => {
  const env=environment();
  try {
    const controller=new AbortController(); const pending=env.api.bridge.requestPageBridge({requestEvent:'article:r',resultEvent:'article:s',signal:controller.signal,ownerId:'article-bridge'});
    assert.equal(env.api.resources.getResourceSnapshot().totalResources,1); controller.abort(); assert.equal((await pending).reason,'bridge_aborted'); assert.equal(env.api.resources.getResourceSnapshot().totalResources,0);
    const pre=new AbortController();pre.abort();let dispatched=0;const off=env.api.bridge.subscribePageBridgeEvent('article:r',()=>dispatched++);
    assert.equal((await env.api.bridge.requestPageBridge({requestEvent:'article:r',resultEvent:'article:s',signal:pre.signal})).reason,'bridge_aborted');assert.equal(dispatched,0);off();
    const released=env.api.bridge.requestPageBridge({requestEvent:'article:r',resultEvent:'article:s',ownerId:'article-bridge'});env.api.resources.releaseOwner('article-bridge');assert.equal((await released).reason,'bridge_aborted');
    let calls=0;env.api.bridge.subscribePageBridgeEvent('article:s',()=>calls++,{ownerId:'article-bridge'});env.api.resources.releaseOwner('article-bridge');env.api.bridge.dispatchPageBridgeEvent('article:s');assert.equal(calls,0);
  } finally {await env.close();}
});
test('core teardown retains ordered stages and injected add-on failure isolation without a product import', async () => {
  const env=environment();
  try{
    const stages=[];env.api.inputs.configureCoreContext({shutdownAddons(reason){stages.push(reason);throw new Error('optional add-on shutdown failure');}});
    const feature=env.api.factory.createFeature('Teardown Article',{disable(context){stages.push(context.reason);}});env.api.catalog.registerFeature(feature);
    env.api.teardown.registerTeardownResetter(()=>stages.push('reset'));env.api.teardown.markRuntimeStarting();env.api.teardown.markRuntimeRunning();
    const first=await env.api.teardown.teardownAll('fixture-stop');assert.equal(first.state,'stopped');assert.ok(first.disabledFeatures.includes(feature.id));assert.ok(first.failures.some(failure=>failure.name==='addons'));
    assert.deepEqual(Array.from(first.completed),['taskQueues','routeObserver','observers','listeners','resources','styles','globalErrorListeners','bootstrap','initialization']);
    assert.deepEqual(stages,['teardown','teardown: fixture-stop','reset']);const second=await env.api.teardown.teardownAll('again');assert.deepEqual(plain(second),plain(first));assert.equal(env.api.teardown.getRuntimeState(),'stopped');
  }finally{await env.close();}
});
test('observer profiler retains slow tick/callback reporting, window summaries and bounded history', async () => {
  {
    const env=environment();
    try{
      let master;env.sandbox.MutationObserver=class{constructor(callback){master=callback;}observe(){}disconnect(){}};
      env.api.observer.setObserverProfilingEnabled(true);let current=0;
      env.api.observer.addObserverCallback('profiled',()=>{current+=20;env.setTime(current);});
      for(let i=0;i<23;i++){current=(i+1)*10001;env.setTime(current);master([{}],{});}
      const key='fixture-app:observer:history';const history=env.sandbox[key];
      assert.equal(history.length,20);assert.equal(history[19].slowTicks,1);assert.equal(history[19].callbacks.profiled.slowRuns,1);
      assert.ok(env.logs.some(entry=>entry.level==='warn'&&entry.args[0].includes('Slow MutationObserver tick')));assert.ok(env.logs.some(entry=>entry.level==='info'));
      assert.equal(env.api.observer.getObserverProfileSnapshot().ticks,0);env.api.observer.resetObserverProfileSnapshot();env.api.observer.setObserverProfilingEnabled(false);
    }finally{await env.close();}
  }
});
test('failed listener or owned bridge registration cannot leak native handlers or remove another resource', async () => {
  const env=environment();
  try{
    const {resources,listeners,bridge}=env.api;const button=env.window.document.createElement('button');let clicks=0;
    resources.resourceManager.register('collision',()=>{},'existing');assert.throws(()=>listeners.addListener('collision',button,'click',()=>clicks++,undefined,'new'),/already registered/);button.click();assert.equal(clicks,0);
    resources.resourceManager.register('page-bridge:request:1',()=>{},'existing');
    await assert.rejects(bridge.requestPageBridge({requestEvent:'collision:r',resultEvent:'collision:s',ownerId:'new'}),/already registered/);
    resources.resourceManager.register('page-bridge:subscription:2',()=>{},'existing');assert.throws(()=>bridge.subscribePageBridgeEvent('collision:s',()=>clicks++,{ownerId:'new'}),/already registered/);bridge.dispatchPageBridgeEvent('collision:s');assert.equal(clicks,0);
    assert.equal(resources.getResourceSnapshot().totalResources,3);assert.equal(resources.getResourceSnapshot().owners.new,undefined);
    await env.clock.tick(2000);assert.equal(resources.getResourceSnapshot().totalResources,3);
  }finally{await env.close();}
});
