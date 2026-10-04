module.exports = function registerGroup(context) {
const { assert, fs, path, ROOT, Window, loadModule, runTest } = context;

const coreAudit = require("../../scripts/core-source-audit.cjs");

const {
    compactCoreModalHtml,
    isCoreModalHtmlPath,
  } = require("../../build/compactCoreModalHtml.js");

runTest("CORE-SIZE-HTML-COMPACT-01 compacts only the core modal deterministically", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/assets/ui.html"), "utf8");
    const first = compactCoreModalHtml(source);
    const second = compactCoreModalHtml(source);

    assert.strictEqual(first, second);
    assert.strictEqual(first.includes("\n"), false);
    assert.ok(Buffer.byteLength(first) < Buffer.byteLength(source));
    assert.strictEqual(isCoreModalHtmlPath(path.join(ROOT, "src/ui/assets/ui.html")), true);
    assert.strictEqual(isCoreModalHtmlPath(path.join(ROOT, "addons/example/ui.html")), false);
    assert.strictEqual(
      compactCoreModalHtml('<div title="keep  this">Visible  text</div>\n  <span>Next</span>'),
      '<div title="keep  this">Visible  text</div> <span>Next</span>',
    );
  });

runTest("CORE-SIZE-HTML-COMPACT-01 preserves the modal element contract", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/ui/assets/ui.html"), "utf8");
    const compacted = compactCoreModalHtml(source);
    const parse = (html) => {
      const window = new Window();
      const root = window.document.createElement("div");
      root.innerHTML = html;
      const snapshot = [...root.querySelectorAll("*")].map((element) => ({
        tag: element.tagName,
        attributes: [...element.attributes]
          .map((attribute) => [attribute.name, attribute.value])
          .sort(([left], [right]) => left.localeCompare(right)),
        text: element.textContent.replace(/\s+/g, " ").trim(),
      }));
      const ids = [...root.querySelectorAll("[id]")].map((element) => element.id).sort();
      const result = { snapshot, ids, text: root.textContent.replace(/\s+/g, " ").trim() };
      window.close();
      return result;
    };

    assert.deepStrictEqual(parse(compacted), parse(source));
    const parsed = parse(compacted);
    for (const id of [
      "settings-nav",
      "close-modal",
      "settings-panel-addins",
      "addins-installed-list",
    ]) {
      assert.strictEqual(parsed.ids.filter((value) => value === id).length, 1, id);
    }
  });

runTest("CORE-SIZE-HTML-COMPACT-01 shares one transform across build and audit", () => {
    const buildSource = fs.readFileSync(path.join(ROOT, "build.js"), "utf8");
    const auditSource = fs.readFileSync(path.join(ROOT, "scripts/core-source-audit.cjs"), "utf8");
    assert.ok(buildSource.includes("compactCoreModalHtmlAsset"));
    assert.ok(auditSource.includes("compactCoreModalHtmlAsset"));
    assert.ok(auditSource.includes("compactCoreModalHtml(source)"));
  });

runTest("CORE-SIZE-HEALTH-UI-01 formats complete and empty support reports", () => {
    const harness = loadModule("tests/fixtures/featureHealthHarness.js");
    const statuses = {
      alpha: {
        status: "degraded",
        details: "bounded detail",
        errorLog: [{ timestamp: "2026-08-01T00:00:00.000Z", details: "safe error" }],
      },
    };
    const addons = [{
      id: "sample",
      name: "Sample",
      status: "needs-update",
      statusMessage: "Update available",
      activeOnPage: true,
      supportsCurrentPage: true,
      blocked: false,
      trusted: true,
    }];
    const report = harness.formatFeatureHealthReport(
      statuses,
      harness.summarizeFeatureStatuses(statuses),
      addons,
      harness.summarizeAddons(addons),
      {
        timestamp: "2026-08-01T00:00:00.000Z",
        page: "https://example.org/threads/sample.1/",
        diagnostics: {
          snapshots: {
            resources: { totalResources: 4, ownerCount: 2 },
            queues: { queueCount: 3, pendingCount: 1, runningCount: 1 },
          },
        },
        runtimeErrors: [{ timestamp: "2026-08-01T00:00:01.000Z", details: "runtime-safe" }],
      },
    );

    for (const expected of [
      `Framework: Aperture v${require("../../package.json").version}`,
      "alpha: degraded - bounded detail",
      "safe error",
      "Resources: total=4, owners=2; Queues: total=3, pending=1, running=1",
      "Runtime errors (1)",
      "Sample (sample): needs-update [active-here, scope-match, trusted] - Update available",
    ]) assert.ok(report.includes(expected), expected);

    const empty = harness.formatFeatureHealthReport(
      {},
      harness.summarizeFeatureStatuses({}),
      [],
      harness.summarizeAddons([]),
      { diagnostics: { snapshots: {} }, runtimeErrors: [], timestamp: "fixed", page: "fixed" },
    );
    assert.ok(empty.includes("No feature status entries found."));
    assert.ok(empty.includes("No installed add-ons detected."));
  });

runTest("CORE-SIZE-HEALTH-UI-01 renders and copies one report without duplicate UI", async () => {
    const previous = {
      window: global.window,
      document: global.document,
      requestAnimationFrame: global.requestAnimationFrame,
      cancelAnimationFrame: global.cancelAnimationFrame,
    };
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(global, "navigator");
    const window = new Window({ url: "https://example.org/threads/sample.1/" });
    global.window = window;
    global.document = window.document;
    Object.defineProperty(global, "navigator", {
      configurable: true,
      value: window.navigator,
    });
    global.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };
    global.cancelAnimationFrame = () => {};
    const copied = [];
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => copied.push(text) },
    });

    try {
      const harness = loadModule("tests/fixtures/featureHealthHarness.js");
      const host = window.document.createElement("div");
      window.document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const container = window.document.createElement("div");
      container.id = "global-settings-container";
      shadow.appendChild(container);
      harness.setFeatureHealthRoot(shadow);

      const first = harness.showFeatureHealthBox({}, "one support payload");
      const second = harness.showFeatureHealthBox({}, "updated support payload");
      assert.strictEqual(first, second);
      assert.strictEqual(shadow.querySelectorAll("#feature-health-box").length, 1);
      const content = second.querySelector(".feature-health-content");
      assert.strictEqual(content.tagName, "PRE");
      assert.strictEqual(content.textContent, "updated support payload");
      assert.strictEqual(content.children.length, 0);

      const retryButton = [...second.querySelectorAll("button")]
        .find((button) => button.textContent === "Retry storage");
      assert.strictEqual(retryButton.hidden, true);
      harness.publishStorageState("unavailable", { reason: "probe_failed", failedStep: "readback" });
      assert.strictEqual(retryButton.hidden, false);
      assert.match(content.textContent, /Storage: state=unavailable/);
      assert.match(content.textContent, /failed-step=readback/);
      harness.publishStorageState("upgrade-required", { reason: "legacy_surface" });
      assert.strictEqual(retryButton.hidden, true);
      assert.match(content.textContent, /Storage: state=upgrade-required/);

      const buttons = [...second.querySelectorAll("button")];
      buttons.find((button) => button.textContent === "Copy").click();
      await Promise.resolve();
      await Promise.resolve();
      assert.deepStrictEqual(copied, [content.textContent]);
      buttons.find((button) => button.textContent === "Close").click();
      assert.strictEqual(second.style.display, "none");

      harness.setFeatureHealthRoot(null);
      const fallbackContainer = window.document.createElement("div");
      fallbackContainer.id = "global-settings-container";
      window.document.body.appendChild(fallbackContainer);
      const fallback = harness.showFeatureHealthBox({}, "fallback payload");
      assert.strictEqual(fallback.parentElement, fallbackContainer);
    } finally {
      global.window = previous.window;
      global.document = previous.document;
      if (navigatorDescriptor) Object.defineProperty(global, "navigator", navigatorDescriptor);
      else delete global.navigator;
      global.requestAnimationFrame = previous.requestAnimationFrame;
      global.cancelAnimationFrame = previous.cancelAnimationFrame;
      window.close();
    }
  });

runTest("CORE-STORAGE-HEALTH-INTEGRATION-01 marks core settings read-only and restores them live", () => {
    const previous = { window: global.window, document: global.document };
    const window = new Window({ url: "https://example.org/threads/sample.1/" });
    global.window = window;
    global.document = window.document;
    try {
      const harness = loadModule("tests/fixtures/featureHealthHarness.js");
      const host = window.document.createElement("div");
      window.document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const panel = window.document.createElement("div");
      panel.className = "settings-panel";
      const row = window.document.createElement("div");
      row.className = "config-row";
      const input = window.document.createElement("input");
      row.appendChild(input);
      panel.appendChild(row);
      const general = window.document.createElement("div");
      general.id = "global-settings-container";
      shadow.append(panel, general);

      harness.syncStorageReadOnlyState(shadow, harness.publishStorageState("degraded-readonly"));
      assert.strictEqual(input.disabled, true);
      assert.match(general.textContent, /Open Feature Health/);
      harness.syncStorageReadOnlyState(shadow, harness.publishStorageState("ready"));
      assert.strictEqual(input.disabled, false);
      assert.strictEqual(general.querySelector("[data-storage-readonly-note]").hidden, true);
    } finally {
      global.window = previous.window;
      global.document = previous.document;
      window.close();
    }
  });
};
