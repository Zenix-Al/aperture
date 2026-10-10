module.exports = function registerGroup(context) {
const { path, fs, assert, createAddonBridgeTransport, createDomSandbox, createFakeClock, createFakeGM, dispatchPageTransition, ROOT, loadModule, runTest, beginRoute, createFeature, createResourceOwner, releaseOwner, createTaskQueue, invokeRegisteredAddonCoreAction, ADDON_UI_SLOT_POLICY, normalizeAddonMountSlot, sanitizeAddonCss, sanitizeAddonHtml } = context;

runTest(
    "ADDON-UI fixed mount policy rejects body and selector targets",
    () => {
      assert.deepStrictEqual(Object.keys(ADDON_UI_SLOT_POLICY).sort(), [
        "page.dock",
        "page.floating",
        "page.panel",
      ]);
      assert.strictEqual(normalizeAddonMountSlot("page.panel"), "page.panel");
      assert.strictEqual(normalizeAddonMountSlot("body"), "");
      assert.strictEqual(normalizeAddonMountSlot("selector:#victim"), "");
    },
  );

runTest(
    "ADDON-UI dock mounts require the dock capability at execution",
    () => {
      const { actionUiMount } = loadModule(
        "src/services/addons/actions/families/ui.js",
      );
      const mount = () => ({ ok: true });
      const sanitizeId = (value) => value;
      assert.strictEqual(
        actionUiMount(
          "example-addon",
          { mountId: "dock", html: "<div></div>", slot: "page.dock" },
          1024,
          sanitizeId,
          mount,
          new Set(["ui.mount"]),
        ).reason,
        "permission_denied",
      );
      assert.strictEqual(
        actionUiMount(
          "example-addon",
          { mountId: "dock", html: "<div></div>", slot: "page.dock" },
          1024,
          sanitizeId,
          mount,
          new Set(["ui.mount", "ui.dock"]),
        ).ok,
        true,
      );
    },
  );

runTest(
    "ADDON-UI descriptor preserves mount-slot capability checks",
    async () => {
      const result = await invokeRegisteredAddonCoreAction({
        addonId: "example-addon",
        action: "ui.mount",
        payload: { mountId: "dock", html: "<div></div>", slot: "page.dock" },
        allowed: new Set(["ui.mount"]),
        deps: {
          sanitizeAddonMountId: (value) => value,
          mountAddonUi: () => ({ ok: true }),
        },
        limits: { maxAddonUiHtmlBytes: 1024 },
        authorize: () => null,
      });
      assert.deepStrictEqual(result, {
        ok: false,
        reason: "permission_denied",
      });
    },
  );

runTest(
    "ADDON-UI sanitizer treats markup as text without a DOM parser",
    () => {
      const previousDocument = global.document;
      try {
        global.document = undefined;
        const sanitized = sanitizeAddonHtml(
          '<img src="javascript:alert(1)" onerror="boom"><script>boom()</script>',
        );
        assert.ok(!sanitized.includes("<script>"));
        assert.ok(!sanitized.includes("<img"));
        assert.ok(sanitized.includes("&lt;script&gt;"));
      } finally {
        global.document = previousDocument;
      }
    },
  );

runTest(
    "ADDON-UI page CSS is owner scoped and rejects global escape hatches",
    () => {
      const scoped = sanitizeAddonCss(
        "example-addon",
        ".card { color: red; } .card > button { display: block; }",
      );
      assert.strictEqual(scoped.ok, true);
      for (const css of ['+ .outside {color:red}', '~ .outside {color:red}', '.card {background: \\75 rl(https://example.test/a)}', '.card {background:image-set("https://example.test/a" 1x)}', '.card {background:-webkit-image-set("a" 1x)}']) {
        assert.strictEqual(sanitizeAddonCss("example-addon", css).ok, false, css);
      }
      const siblings = sanitizeAddonCss("example-addon", '.card + .other {color:red}');
      assert.strictEqual(siblings.ok, true);
      assert.ok(!siblings.cssText.includes('[data-addon-id="example-addon"].card +'));
      assert.ok(
        scoped.cssText.includes('[data-addon-id="example-addon"] .card'),
      );
      assert.strictEqual(
        sanitizeAddonCss("example-addon", "body { display: none; }").reason,
        "unsafe_css_selector",
      );
      assert.strictEqual(
        sanitizeAddonCss(
          "example-addon",
          "@import url(https://example.test/a.css);",
        ).reason,
        "unsafe_css",
      );
      assert.strictEqual(
        sanitizeAddonCss(
          "example-addon",
          ".card { background: url(https://example.test/a.png); }",
        ).reason,
        "unsafe_css",
      );
    },
  );

runTest(
    "TEST-01 DOM sanitizer strips active content while retaining safe add-on markup",
    () => {
      const sandbox = createDomSandbox();
      try {
        const { sanitizeAddonHtml } = loadModule(
          "src/services/addons/uiSanitizer.js",
        );
        const html = sanitizeAddonHtml(
          '<button class="safe" onclick="boom()">Run</button><a href="javascript:boom()">bad</a><iframe srcdoc="x"></iframe><svg onload="boom()"></svg>',
        );
        sandbox.document.body.innerHTML = html;
        assert.strictEqual(
          sandbox.document.querySelectorAll("button.safe").length,
          1,
        );
        assert.strictEqual(
          sandbox.document.querySelector("button").getAttribute("onclick"),
          null,
        );
        assert.strictEqual(
          sandbox.document.querySelector("a").getAttribute("href"),
          null,
        );
        assert.strictEqual(sandbox.document.querySelector("iframe"), null);
        assert.strictEqual(sandbox.document.querySelector("svg"), null);
      } finally {
        sandbox.restore();
      }
    },
  );

runTest(
    "ADDON-UI preserves an inert hidden JSON file picker",
    () => {
      const sandbox = createDomSandbox();
      try {
        const { sanitizeAddonHtml } = loadModule(
          "src/services/addons/uiSanitizer.js",
        );
        const managerHtml = '<input type="file" data-field="importFile" hidden accept="application/json,.json">';
        sandbox.document.body.innerHTML = sanitizeAddonHtml(managerHtml);
        const input = sandbox.document.querySelector(
          'input[data-field="importFile"]',
        );
        assert.ok(
          input,
          "Generic import input must survive sanitization",
        );
        assert.strictEqual(input.hasAttribute("hidden"), true);
        assert.strictEqual(
          input.getAttribute("accept"),
          "application/json,.json",
        );
        assert.strictEqual(input.getAttribute("type"), "file");

      } finally {
        sandbox.restore();
      }
    },
  );

runTest(
    "TEST-01 deterministic helpers isolate GM storage and timers",
    async () => {
      const gm = createFakeGM({ value: 1 });
      await gm.setValue("value", 2);
      const clock = createFakeClock();
      const events = [];
      clock.setTimeout(() => events.push("late"), 10);
      clock.setTimeout(() => events.push("early"), 5);
      await clock.tick(10);
      assert.deepStrictEqual(events, ["early", "late"]);
      assert.strictEqual(clock.pending(), 0);
    },
  );

runTest(
    "TEST-01 reusable page lifecycle and add-on bridge fakes preserve event state",
    () => {
      const sandbox = createDomSandbox();
      try {
        let persisted = null;
        sandbox.window.addEventListener("pagehide", (event) => {
          persisted = event.persisted;
        });
        dispatchPageTransition(sandbox.window, "pagehide", true);
        assert.strictEqual(persisted, true);
        const bridge = createAddonBridgeTransport(sandbox.window);
        const received = [];
        const unsubscribe = bridge.subscribe((event) =>
          received.push(event.detail),
        );
        bridge.send({ requestId: "TEST-01-request", action: "storage.get" });
        unsubscribe();
        assert.deepStrictEqual(received, [
          { requestId: "TEST-01-request", action: "storage.get" },
        ]);
      } finally {
        sandbox.restore();
      }
    },
  );

runTest(
    "TEST-01 lifecycle rapid route transitions commit only the latest operation",
    async () => {
      const commits = [];
      const feature = createFeature("TEST Route Lifecycle", {
        enable: async (context) => {
          await Promise.resolve();
          if (!context.signal.aborted) commits.push(context.routeGeneration);
        },
        disable: () => null,
      });
      const first = feature.enable({
        routeGeneration: 1,
        correlationId: "route-a",
      });
      const second = feature.enable({
        routeGeneration: 2,
        correlationId: "route-b",
      });
      const third = feature.enable({
        routeGeneration: 3,
        correlationId: "route-c",
      });
      await Promise.allSettled([first, second, third]);
      assert.deepStrictEqual(commits, [3]);
      await feature.disable({ reason: "teardown" });
    },
  );

runTest(
    "TEST-01 lifecycle enable route disable and re-enable leaves no stale commit",
    async () => {
      const events = [];
      const feature = createFeature("TEST Route Re-enable", {
        enable: async (context) => {
          if (!context.signal.aborted)
            events.push(`enable:${context.routeGeneration}`);
        },
        disable: async () => {
          events.push("disable");
        },
      });
      await feature.enable({ routeGeneration: 1, correlationId: "route-1" });
      await feature.disable({ routeGeneration: 2, reason: "route-change" });
      await feature.enable({ routeGeneration: 3, correlationId: "route-3" });
      assert.deepStrictEqual(events, ["enable:1", "disable", "enable:3"]);
    },
  );

runTest(
    "ROUTE-01 DOM observer coalesces dispatch while preserving distinct generations and cleanup",
    async () => {
      const sandbox = createDomSandbox("https://example.org/threads/a.1/");
      try {
        const route = loadModule("src/core/routeObserver.js");
        const contexts = [];
        const originalPushState = sandbox.window.history.pushState;
        const originalReplaceState = sandbox.window.history.replaceState;
        const cleanup = route.initRouteObserver((context) =>
          contexts.push(context),
        );
        sandbox.window.history.pushState({}, "", "/threads/b.2/");
        sandbox.window.history.pushState({}, "", "/threads/c.3/");
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(contexts.length, 1);
        assert.ok(contexts[0].url.includes("/threads/c.3/"));
        assert.strictEqual(contexts[0].generation, 2);
        cleanup();
        assert.strictEqual(sandbox.window.history.pushState, originalPushState);
        assert.strictEqual(
          sandbox.window.history.replaceState,
          originalReplaceState,
        );
      } finally {
        sandbox.restore();
      }
    },
  );

runTest("ROUTE-01 full teardown restores route history patches", async () => {
    const sandbox = createDomSandbox("https://example.org/threads/a.1/");
    try {
      const result = await loadModule(
        "tests/fixtures/routeTeardownHarness.js",
      ).runRouteTeardownScenario();
      assert.strictEqual(result.patched, true);
      assert.strictEqual(result.restored, true);
    } finally {
      sandbox.restore();
    }
  });

runTest(
    "TEST-01 teardown suspension, resume, and full cleanup are idempotent",
    async () => {
      const teardown = loadModule("src/core/teardown.js");
      teardown.resetTeardownForTests();
      teardown.markRuntimeRunning();
      assert.strictEqual(teardown.suspendRuntime("bfcache").state, "suspended");
      assert.strictEqual(teardown.suspendRuntime("bfcache").state, "suspended");
      assert.strictEqual(teardown.resumeRuntime(), "running");
      const summary = await teardown.teardownAll("TEST-01");
      assert.strictEqual(summary.state, "stopped");
      assert.strictEqual(teardown.getRuntimeState(), "stopped");
      teardown.resetTeardownForTests();
    },
  );

runTest(
    "TEARDOWN-01 full teardown is bounded, idempotent, and disposes queues/resources",
    async () => {
      const result = await loadModule(
        "tests/fixtures/teardownHarness.js",
      ).runTeardownResourceScenario();
      assert.strictEqual(result.first.state, "stopped");
      assert.strictEqual(
        result.first.failures.some((failure) => failure.code === "timeout"),
        true,
      );
      assert.deepStrictEqual(result.second, result.first);
      assert.strictEqual(result.queues.queueCount, 0);
      assert.strictEqual(result.resources.totalResources, 0);
    },
  );

runTest("PERSIST-01 storage adapter remains a raw I/O boundary", async () => {
    const calls = [];
    const values = new Map();
    const adapter = loadModule(
      "src/services/storageAdapter.js",
    ).createStorageAdapter({
      async getValue(key, fallback) {
        calls.push(["get", key]);
        return values.has(key) ? values.get(key) : fallback;
      },
      async setValue(key, value) {
        calls.push(["set", key]);
        values.set(key, value);
      },
      async deleteValue(key) {
        calls.push(["delete", key]);
        values.delete(key);
      },
    });
    await adapter.set("raw", { value: 1 });
    assert.deepStrictEqual(await adapter.get("raw", null), { value: 1 });
    await adapter.delete("raw");
    assert.deepStrictEqual(
      calls.map(([operation]) => operation),
      ["set", "get", "delete"],
    );
  });

runTest(
    "CORE-STORAGE-CAPABILITY-PROBE-01 verifies and cleans a sync or async storage API",
    async () => {
      const { probeStorageCapabilities } = loadModule("src/services/storageAdapter.js");
      for (const asynchronous of [false, true]) {
        const values = new Map();
        const settle = (value) => asynchronous ? Promise.resolve(value) : value;
        const api = {
          info: { scriptHandler: asynchronous ? "ScriptCat" : "Tampermonkey" },
          getValue: (key, fallback) => settle(values.has(key) ? values.get(key) : fallback),
          setValue: (key, value) => settle(values.set(key, value) && undefined),
          deleteValue: (key) => settle(values.delete(key) && undefined),
        };
        const result = await probeStorageCapabilities(api, { probeId: asynchronous ? "async" : "sync" });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.canRead, true);
        assert.strictEqual(result.canWrite, true);
        assert.strictEqual(result.canDelete, true);
        assert.strictEqual(result.manager, asynchronous ? "ScriptCat" : "Tampermonkey");
        assert.strictEqual(values.size, 0);
      }
    },
  );

runTest(
    "CORE-STORAGE-CAPABILITY-PROBE-01 classifies unsupported rejected false and mismatched operations",
    async () => {
      const { probeStorageCapabilities } = loadModule("src/services/storageAdapter.js");
      const unsupported = await probeStorageCapabilities({ getValue() {}, setValue() {} });
      assert.strictEqual(unsupported.reason, "delete_unsupported");

      const rejected = await probeStorageCapabilities({
        getValue: async (_key, fallback) => fallback,
        setValue: async () => { throw new Error("manager_write_rejected"); },
        deleteValue: async () => undefined,
      });
      assert.strictEqual(rejected.failedStep, "write");
      assert.strictEqual(rejected.reason, "write_failed");

      const falseWrite = await probeStorageCapabilities({
        getValue: (_key, fallback) => fallback,
        setValue: () => false,
        deleteValue: () => undefined,
      });
      assert.strictEqual(falseWrite.reason, "write_returned_false");

      const mismatched = await probeStorageCapabilities({
        getValue: (_key, fallback) => fallback,
        setValue: () => undefined,
        deleteValue: () => undefined,
      });
      assert.strictEqual(mismatched.failedStep, "readback");
      assert.strictEqual(mismatched.reason, "readback_mismatch");
    },
  );

runTest(
    "CORE-STORAGE-CAPABILITY-PROBE-01 reports cleanup failure and preserves the primary reason",
    async () => {
      const { probeStorageCapabilities } = loadModule("src/services/storageAdapter.js");
      const values = new Map();
      const result = await probeStorageCapabilities({
        getValue: (key, fallback) => values.has(key) ? values.get(key) : fallback,
        setValue: (key, value) => { values.set(key, value); },
        deleteValue: () => { throw new Error("manager_delete_rejected"); },
      }, { probeId: "cleanup" });
      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.failedStep, "delete");
      assert.strictEqual(result.reason, "cleanup_failed");
      assert.strictEqual(result.cleanupReason, "delete_failed");
      assert.strictEqual(values.size, 1);
    },
  );

runTest(
    "CORE-STORAGE-CAPABILITY-PROBE-01 concurrent probes own distinct cleanup keys",
    async () => {
      const { probeStorageCapabilities } = loadModule("src/services/storageAdapter.js");
      const values = new Map();
      const written = [];
      const deleted = [];
      const api = {
        getValue: async (key, fallback) => values.has(key) ? values.get(key) : fallback,
        setValue: async (key, value) => { written.push(key); values.set(key, value); },
        deleteValue: async (key) => { deleted.push(key); values.delete(key); },
      };
      const results = await Promise.all([
        probeStorageCapabilities(api, { probeId: "tab-a" }),
        probeStorageCapabilities(api, { probeId: "tab-b" }),
      ]);
      assert.deepStrictEqual(results.map((result) => result.ok), [true, true]);
      assert.strictEqual(new Set(written).size, 2);
      assert.deepStrictEqual(new Set(deleted), new Set(written));
      assert.strictEqual(values.size, 0);
    },
  );

runTest(
    "TRANSFER-LEAN-01 keeps the transfer domain DOM-free and the UI one-way",
    () => {
      const serviceSource = fs.readFileSync(
        path.join(ROOT, "src/services/configTransfer/index.js"),
        "utf8",
      );
      const uiSource = fs.readFileSync(
        path.join(ROOT, "src/ui/configTransfer/index.js"),
        "utf8",
      );
      assert.doesNotMatch(
        serviceSource,
        /src[\\/](?:features|ui)|from ["'][^"']*ui/,
      );
      assert.match(uiSource, /services[\\/]configTransfer[\\/]index\.js/);
      assert.doesNotMatch(uiSource, /features[\\/]config-transfer/);
      assert.strictEqual(
        fs.existsSync(path.join(ROOT, "src/features/config-transfer")),
        false,
      );

      const manifest =
        require("../../scripts/featureManifest.cjs").buildFeatureManifestState({
          rootDir: ROOT,
        });
      assert.strictEqual(
        manifest.entries.some((entry) =>
          entry.relativePath.includes("config-transfer"),
        ),
        false,
      );
      assert.strictEqual(
        manifest.featureNames.includes("configTransferFeature"),
        false,
      );
    },
  );

runTest(
    "TRANSFER-LEAN-01 file picker cancellation removes temporary DOM and listeners",
    async () => {
      const sandbox = createDomSandbox();
      try {
        const transferIO = loadModule("src/ui/configTransfer/transferIO.js");
        const picker = transferIO.createJsonFilePicker();
        assert.strictEqual(
          document.querySelectorAll('input[type="file"]').length,
          1,
        );
        picker.cancel();
        assert.strictEqual(await picker.promise, null);
        assert.strictEqual(
          document.querySelectorAll('input[type="file"]').length,
          0,
        );
      } finally {
        sandbox.restore();
      }
    },
  );

runTest(
    "TEST-01 BFCache page lifecycle suspends, resumes fresh route work, and fully tears down",
    async () => {
      const { createPageLifecycleHandlers } = loadModule(
        "src/core/pageLifecycle.js",
      );
      const calls = [];
      let beginRouteOptions = null;
      const handlers = createPageLifecycleHandlers({
        suspendRuntime: (reason) => calls.push(`suspend:${reason}`),
        teardownAll: async (reason) => calls.push(`teardown:${reason}`),
        resumeRuntime: () => calls.push("resume"),
        beginRoute: (_location, options) => {
          beginRouteOptions = options;
          return { generation: 9, correlationId: "route-9" };
        },
        detectPage: () => calls.push("detect"),
        refreshFastBootstrapFeatures: (context) =>
          calls.push(`fast:${context.generation}`),
        reconcileFeatures: async (context) =>
          calls.push(`reconcile:${context.generation}`),
      });
      handlers.handlePageHide({ persisted: true });
      await handlers.handlePageShow({ persisted: true });
      await handlers.handlePageHide({ persisted: false });
      assert.deepStrictEqual(calls, [
        "suspend:bfcache",
        "resume",
        "detect",
        "fast:9",
        "reconcile:9",
        "teardown:pagehide",
      ]);
      assert.deepStrictEqual(beginRouteOptions, { force: true });
    },
  );

runTest(
    "TEST-01 resource leak assertion detects and clears owner resources",
    () => {
      const resources = loadModule("src/core/resourceManager.js");
      resources.resetResourceManagerForTests();
      const owner = resources.createResourceOwner("TEST-01:leak-owner");
      owner.register("TEST-01:leaked-listener", () => {});
      assert.throws(
        () => resources.assertNoResourceLeaks("TEST-01:leak-owner"),
        /Resource leak/,
      );
      resources.releaseOwner("TEST-01:leak-owner");
      assert.strictEqual(
        resources.assertNoResourceLeaks("TEST-01:leak-owner"),
        true,
      );
    },
  );

runTest(
    "TEST-01 add-on UI ownership rejects cross-owner mutation and cleans every resource",
    () => {
      const sandbox = createDomSandbox();
      try {
        const host = loadModule("src/services/addons/uiHost.js", { themeCss: "" });
        assert.strictEqual(
          host.mountAddonUi("addon-a", {
            mountId: "panel",
            slot: "page.panel",
            html: '<button onclick="bad()">Safe</button>',
          }).ok,
          true,
        );
        assert.strictEqual(
          host.updateAddonUi("addon-b", { mountId: "panel", html: "stolen" })
            .reason,
          "mount_not_found",
        );
        assert.strictEqual(
          host.registerAddonStyle("addon-a", {
            styleId: "panel",
            cssText: ".panel { color: red; }",
          }).ok,
          true,
        );
        assert.strictEqual(
          host.openAddonDialog("addon-a", {
            dialogId: "dialog",
            html: '<div data-preserve-scroll="main">Dialog</div>',
          }).ok,
          true,
        );
        const dialogSurface = document.querySelector(".aperture-addon-dialog-surface");
        assert.ok(["#1f2329", "rgb(31, 35, 41)"].includes(dialogSurface.style.background));
        assert.strictEqual(dialogSurface.style.borderRadius, "10px");
        assert.strictEqual(dialogSurface.style.overflow, "auto");
        const scrollRegion = document.querySelector('[data-preserve-scroll="main"]');
        scrollRegion.scrollTop = 73;
        assert.strictEqual(
          host.updateAddonDialog("addon-b", {
            dialogId: "dialog",
            html: "stolen",
          }).reason,
          "dialog_not_found",
        );
        assert.strictEqual(
          host.updateAddonDialog("addon-a", {
            dialogId: "dialog",
            html: '<div data-preserve-scroll="main">Updated safely</div>',
          }).ok,
          true,
        );
        assert.strictEqual(
          document.querySelector('[data-preserve-scroll="main"]').scrollTop,
          73,
        );
        assert.strictEqual(
          host.openAddonDialog("addon-a", {
            dialogId: "self-scrolling-dialog",
            html: '<div class="self-scroller">Self scrolling</div>',
            scrollMode: "addon",
          }).ok,
          true,
        );
        const selfScrollingSurface = document.querySelector(
          '[data-dialog-id="self-scrolling-dialog"].aperture-addon-dialog-surface',
        );
        const selfScrollingContent = document.querySelector(
          '#aperture-example-aperture_example-addon-dialog-content-addon-a-self-scrolling-dialog',
        );
        assert.strictEqual(selfScrollingSurface.style.overflow, "hidden");
        assert.strictEqual(selfScrollingContent.style.overflow, "hidden");
        assert.strictEqual(selfScrollingContent.style.minHeight, "0");
        host.cleanupAddonUi("addon-a");
        assert.strictEqual(
          host.updateAddonDialog("addon-a", {
            dialogId: "dialog",
            html: "late",
          }).reason,
          "dialog_not_found",
        );
        const owners = host.getAddonUiPolicySnapshot().owners;
        assert.deepStrictEqual(owners, {
          docks: [],
          dialogs: [],
          mounts: [],
          pendingMounts: [],
          styles: [],
        });
        host.resetAddonUiHostForTests();
      } finally {
        sandbox.restore();
      }
    },
  );

runTest(
    "TEST-01 lifecycle timeout and repeated applicability transitions settle deterministically",
    async () => {
      const clock = createFakeClock();
      const previousSetTimeout = global.setTimeout;
      const previousClearTimeout = global.clearTimeout;
      global.setTimeout = clock.setTimeout;
      global.clearTimeout = clock.clearTimeout;
      try {
        const timed = createFeature("TEST-01 Timeout Feature", {
          enable: () => new Promise(() => {}),
          disable: () => null,
        });
        const operation = timed.enable();
        for (let index = 0; index < 8 && clock.pending() === 0; index += 1)
          await Promise.resolve();
        assert.ok(clock.pending() > 0);
        await clock.tick(15000);
        await assert.rejects(operation, /timeout/i);
        let applicable = false;
        const transitions = [];
        const feature = createFeature("TEST-01 Applicability Feature", {
          isApplicable: () => applicable,
          enable: () => transitions.push("enable"),
          disable: () => transitions.push("disable"),
        });
        assert.strictEqual(await feature.enable(), false);
        applicable = true;
        await feature.enable();
        applicable = false;
        await feature.disable();
        applicable = true;
        await feature.enable();
        assert.deepStrictEqual(transitions, ["enable", "disable", "enable"]);
      } finally {
        global.setTimeout = previousSetTimeout;
        global.clearTimeout = previousClearTimeout;
      }
    },
  );

runTest(
    "TEST-01 queue timeout reports final idle state without sleeps",
    async () => {
      const clock = createFakeClock();
      const previousSetTimeout = global.setTimeout;
      const previousClearTimeout = global.clearTimeout;
      global.setTimeout = clock.setTimeout;
      global.clearTimeout = clock.clearTimeout;
      try {
        const { createTaskQueue: createQueue } = loadModule(
          "src/core/taskQueue.js",
        );
        const queue = createQueue({
          name: "TEST-01-timeout",
          ownerId: "TEST-01:queue-timeout",
          delay: 0,
          timeoutMs: 5,
        });
        let startedResolve;
        const started = new Promise((resolve) => {
          startedResolve = resolve;
        });
        const task = queue.add("blocked", () => {
          startedResolve();
          return new Promise(() => {});
        });
        await clock.tick(0);
        await started;
        await clock.tick(5);
        assert.strictEqual((await task).status, "cancelled");
        const idle = await queue.whenIdle();
        assert.strictEqual(idle.runningKey, null);
        await queue.dispose();
      } finally {
        global.setTimeout = previousSetTimeout;
        global.clearTimeout = previousClearTimeout;
      }
    },
  );

runTest(
    "TEST-01 malformed payloads are rejected across add-on action categories",
    async () => {
      for (const action of [
        "toast.show",
        "storage.set",
        "idb.put",
        "observer.watch",
        "ui.mount",
        "ui.dialog.open",
        "ui.style.register",
      ]) {
        const result = await invokeRegisteredAddonCoreAction({
          addonId: "test-addon",
          action,
          payload: null,
          deps: {},
          limits: {},
          authorize: () => null,
        });
        assert.strictEqual(result.reason, "invalid_payload", action);
      }
    },
  );

function createLatestAjaxPageBridgeHarness({
    jQuery = null,
    querySelector = () => null,
  } = {}) {
    const listeners = new Map();
    class FakeCustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    }
    const windowLike = {
      jQuery,
      CustomEvent: FakeCustomEvent,
      MouseEvent: FakeCustomEvent,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event) {
        for (const listener of [...(listeners.get(event.type) || [])])
          listener(event);
        return true;
      },
    };
    const root = {
      dataset: {},
      appendChild(script) {
        Function(
          "window",
          "document",
          "CustomEvent",
          script.textContent,
        )(windowLike, documentLike, FakeCustomEvent);
        return script;
      },
    };
    const documentLike = {
      documentElement: root,
      createElement: () => ({ type: "", textContent: "", remove() {} }),
      querySelector,
    };
    return { windowLike, documentLike };
  }
};
