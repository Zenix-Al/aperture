module.exports = function registerGroup(context) {
const { assert, fs, loadModule, path, ROOT, runTest, Window } = context;

runTest("MODAL-CSS-SPLIT-01 installs modal CSS once and reacquires after cleanup", () => {
    const previousDocument = global.document;
    const window = new Window();
    global.document = window.document;
    try {
      const harness = loadModule("tests/fixtures/modal-css-harness.js", {
        loader: { ".css": "text" },
      });
      const host = window.document.createElement("div");
      window.document.body.appendChild(host);
      const shadowRoot = host.attachShadow({ mode: "open" });
      harness.resetModalCssHarness(shadowRoot);

      harness.injectCSS();
      let snapshot = harness.getStyleRegistrySnapshot();
      assert.ok(snapshot["base-ui"]);
      assert.strictEqual(snapshot["base-modal-ui"], undefined);
      assert.strictEqual(shadowRoot.querySelectorAll("style").length, 1);

      assert.strictEqual(harness.ensureModalCss(), true);
      assert.strictEqual(harness.ensureModalCss(), true);
      snapshot = harness.getStyleRegistrySnapshot();
      assert.strictEqual(snapshot["base-modal-ui"].refs, 1);
      assert.strictEqual(shadowRoot.querySelectorAll("style").length, 2);

      harness.clearAllStyles();
      harness.injectCSS();
      assert.strictEqual(harness.ensureModalCss(), true);
      snapshot = harness.getStyleRegistrySnapshot();
      assert.strictEqual(snapshot["base-modal-ui"].refs, 1);
      assert.strictEqual(shadowRoot.querySelectorAll("style").length, 2);
      harness.clearAllStyles();
    } finally {
      global.document = previousDocument;
      window.close();
    }
  });

runTest("MODAL-CSS-SPLIT-01 acquires modal CSS before modal construction", () => {
    const modalSource = fs.readFileSync(path.join(ROOT, "src/ui/components/modal.js"), "utf8");
    const ensureIndex = modalSource.indexOf("ensureModalCss();");
    const initializeIndex = modalSource.indexOf("await initModalUi();");
    const visibleIndex = modalSource.indexOf('.style.display = "block"');
    assert.ok(ensureIndex >= 0);
    assert.ok(ensureIndex < initializeIndex);
    assert.ok(initializeIndex < visibleIndex);
  });

runTest("MODAL-CSS-SPLIT-01 shared dialogs acquire modal CSS before mounting", () => {
    const dialogSource = fs.readFileSync(
      path.join(ROOT, "src/ui/components/dialog.js"),
      "utf8",
    );
    assert.match(dialogSource, /function getDialogRoot\(\)[\s\S]*ensureModalCss\(\)/);
    assert.strictEqual(
      [...dialogSource.matchAll(/const shadowRoot = getDialogRoot\(\);/g)].length,
      4,
    );
  });
};
