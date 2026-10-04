const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  loadProject,
  parseJson,
  header,
  configArgument,
} = require("../scripts/projectConfig.cjs");
const coreBuilder = require("../build.js");
const addonBuilder = require("../addons/build-addon.js");
const catalog = require("../scripts/addon-catalog.cjs");
const {
  checkProjectFeatureManifest,
  generateProjectFeatureManifest,
} = require("../scripts/featureManifest.cjs");
const { writeOutputs } = require("../build/writeOutputs.cjs");
const ROOT = path.resolve(__dirname, "..");
const TMP = path.join(__dirname, ".tmp-project-build");
fs.mkdirSync(TMP, { recursive: true });
function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}
function fixture() {
  const root = fs.mkdtempSync(path.join(TMP, "project-"));
  const config = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config.json"), "utf8"),
  );
  const addonDocument = JSON.parse(
    fs.readFileSync(path.join(ROOT, config.build.addonsManifest), "utf8"),
  );
  write(root, "config.json", config);
  if (config.build.application) write(root, config.build.application, "export default {};");
  if (config.build.ui) write(root, config.build.ui, "export default {}; ");
  if (config.build.settings) write(root, config.build.settings, "export default { schema: {} };");
  write(root, config.build.versionFile, { major: 0, minor: 1, patch: 0 });
  write(
    root,
    "themes/default/index.css",
    fs.readFileSync(path.join(ROOT, "themes/default/index.css"), "utf8").replace("#893839", "#663399"),
  );
  // Build-boundary fixture consumes the actual original logger, not a replacement.
  write(
    root,
    "src/core/logger.js",
    fs.readFileSync(path.join(ROOT, "src/core/logger.js"), "utf8"),
  );
  write(
    root,
    "src/generated/features.generated.js",
    'throw new Error("original product manifest must not be bundled");',
  );
  write(
    root,
    "src/main.js",
    `import project from 'aperture:project';
import framework from 'aperture:framework';
import theme from 'aperture:theme';
import { generatedFeatures } from './generated/features.generated.js';
import { debugLog } from './core/logger.js';
debugLog(project.id, 'fixture-development-log', { data: { fixture: true }, level: 'warn' });
globalThis.fixtureResult = { project, framework, theme, features: generatedFeatures.map(feature => feature.id) };`,
  );
  write(
    root,
    "projects/example/features/fixture/index.js",
    'export const fixtureFeature = { id: "fixture-feature" };',
  );
  write(
    root,
    addonDocument.addons[0].entry,
    `import project from 'aperture:project';
import framework from 'aperture:framework';
import theme from 'aperture:theme';
globalThis.fixtureAddon = { project, theme, id: __ADDON_ID__, name: __ADDON_NAME__, version: __ADDON_VERSION__, scopes: __ADDON_PAGE_SCOPES__, matches: __ADDON_MATCHES__, capabilities: __ADDON_CAPABILITIES__ };`,
  );
  write(root, config.build.addonsManifest, addonDocument);
  return {
    root,
    config,
    addonDocument,
    save() {
      write(root, "config.json", config);
      write(root, config.build.addonsManifest, addonDocument);
    },
    load() {
      return loadProject({ rootDir: root });
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("application inputs obey repository/source boundaries and cannot be generated outputs", () => {
  const f = fixture();
  try {
    for (const value of ["../outside/application.js", "missing/application.js", f.config.build.featureManifest]) {
      f.config.build.application = value; f.save();
      assert.throws(() => f.load());
    }
    f.config.build.application = "projects/example/dist/application.js";
    write(f.root, f.config.build.application, "export default {};"); f.save();
    assert.throws(() => f.load(), /collision|generated directories/);
  } finally { f.dispose(); }
});

test("JSON routes support the original exact-host/path/query/hash/regex matcher fields with validation", () => {
  const f = fixture();
  try {
    f.config.routes = { isArticle: { hostEquals: ["example.org", "localhost"], pathEquals: ["/article"], hrefIncludes: ["?q=", "#results"], pathPattern: ["^/article$"] } };
    f.save(); assert.deepEqual(f.load().routes, f.config.routes);
    f.config.routes.isArticle.pathPattern = ["["]; f.save(); assert.throws(() => f.load(), /regular expression/);
    delete f.config.routes.isArticle.pathPattern; f.config.routes.isArticle.match = "() => true"; f.save(); assert.throws(() => f.load(), /unknown|unsupported|Unexpected/i);
  } finally { f.dispose(); }
});
function snapshot(root) {
  const result = {};
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else
        result[path.relative(root, file)] = fs
          .readFileSync(file)
          .toString("base64");
    }
  }
  visit(root);
  return result;
}
function execute(code) {
  const logs = [];
  const context = {
    console: {
      groupCollapsed: (...args) => logs.push(args),
      groupEnd() {},
      warn: (...args) => logs.push(args),
      log: (...args) => logs.push(args),
    },
  };
  vm.runInNewContext(code, context);
  return { context, logs };
}
test("JSON parser rejects nested and escaped duplicate keys; config option is explicit", () => {
  assert.throws(
    () => parseJson('{"a":{"name":1,"na\\u006de":2}}'),
    /config.a.name: duplicate key/,
  );
  assert.throws(() => configArgument(["--config"]), /missing path/);
  assert.throws(
    () => configArgument(["--config", "a", "--config", "b"]),
    /twice/,
  );
});
const invalidCases = [
  [
    "schema version",
    (f) => {
      f.config.schemaVersion = 2;
    },
    /schemaVersion/,
  ],
  [
    "unknown field",
    (f) => {
      f.config.metadata.extra = "x";
    },
    /metadata.extra/,
  ],
  [
    "empty matches",
    (f) => {
      f.config.metadata.matches = [];
    },
    /matches/,
  ],
  [
    "duplicate matches",
    (f) => {
      f.config.metadata.matches.push(f.config.metadata.matches[0]);
    },
    /duplicate/,
  ],
  [
    "invalid match",
    (f) => {
      f.config.metadata.matches = ["<all_urls>"];
    },
    /match pattern/,
  ],
  [
    "invalid host",
    (f) => {
      f.config.metadata.matches = ["https://bad..example/*"];
    },
    /match host/,
  ],
  [
    "invalid port",
    (f) => {
      f.config.metadata.matches = ["http://localhost:99999/*"];
    },
    /port/,
  ],
  [
    "invalid grants",
    (f) => {
      f.config.metadata.grants = ["GM_secret"];
    },
    /grant/,
  ],
  [
    "none conflict",
    (f) => {
      f.config.metadata.grants = ["none", "GM_getValue"];
    },
    /alone/,
  ],
  [
    "invalid run timing",
    (f) => {
      f.config.metadata.runAt = "whenever";
    },
    /runAt/,
  ],
  [
    "header injection",
    (f) => {
      f.config.metadata.name += "\n// @grant GM_download";
    },
    /single line/,
  ],
  [
    "unicode newline",
    (f) => {
      f.config.metadata.name += "\u2028x";
    },
    /single line/,
  ],
  [
    "invalid ID",
    (f) => {
      f.config.id = "Display Name";
    },
    /identifier/,
  ],
  [
    "invalid namespace",
    (f) => {
      f.config.metadata.namespace = "javascript:alert(1)";
    },
    /HTTP/,
  ],
  [
    "URL credentials",
    (f) => {
      f.config.metadata.icon = "https://user:pass@example.org/x";
    },
    /credentials/,
  ],
  [
    "unknown route field",
    (f) => {
      f.config.routes.isExample.regex = "^x";
    },
    /unknown field/,
  ],
  [
    "route function string",
    (f) => {
      f.config.routes.isExample.hostIncludes = "()=>true";
    },
    /array/,
  ],
  [
    "route prefix",
    (f) => {
      f.config.routes.isExample.pathStartsWith = ["relative"];
    },
    /starting with/,
  ],
  [
    "empty routes",
    (f) => {
      f.config.routes = {};
    },
    /declaration/,
  ],
  [
    "path escape",
    (f) => {
      f.config.build.entry = "../original/main.js";
    },
    /safe repository/,
  ],
  [
    "absolute path",
    (f) => {
      f.config.build.outputDir = "C:/outside";
    },
    /safe repository/,
  ],
  [
    "reserved source",
    (f) => {
      f.config.build.entry = "node_modules/example.js";
    },
    /reserved directory/,
  ],
  [
    "generated source",
    (f) => {
      f.config.build.entry = "src/generated/features.generated.js";
    },
    /generated directories/,
  ],
  [
    "source collision",
    (f) => {
      f.config.build.featureManifest = f.config.build.versionFile;
    },
    /collision/,
  ],
  [
    "output collision",
    (f) => {
      f.config.build.cacheFile = f.config.build.featureManifest;
    },
    /collision/,
  ],
  [
    "catalog collision",
    (f) => {
      f.config.build.catalogDir = f.config.build.outputDir;
    },
    /collision/,
  ],
  [
    "features output collision",
    (f) => {
      f.config.build.outputDir = f.config.build.featuresDir;
    },
    /feature inputs/,
  ],
  [
    "missing selected theme",
    (f) => {
      f.config.theme = "absent";
    },
    /theme.selected/,
  ],
  [
    "theme escape",
    (f) => {
      f.config.theme = "../outside";
    },
    /theme directory/,
  ],
  [
    "missing default theme",
    (f) => {
      fs.rmSync(path.join(f.root, "themes/default/index.css"));
    },
    /theme.default/,
  ],
  [
    "missing entry",
    (f) => {
      fs.rmSync(path.join(f.root, f.config.build.entry));
    },
    /build.entry/,
  ],
  [
    "bad version range",
    (f) => {
      write(f.root, f.config.build.versionFile, {
        major: -1,
        minor: 0,
        patch: 0,
      });
    },
    /version.major/,
  ],
];
for (const [name, change, expected] of invalidCases)
  test(`invalid config: ${name} fails without writes`, async () => {
    const f = fixture();
    try {
      change(f);
      f.save();
      const before = snapshot(f.root);
      await assert.rejects(
        coreBuilder.main(["--smoke", "--bump"], { rootDir: f.root }),
        expected,
      );
      await assert.rejects(
        addonBuilder.main(["--smoke", "--bump"], { rootDir: f.root }),
        expected,
      );
      assert.deepEqual(snapshot(f.root), before);
    } finally {
      f.dispose();
    }
  });
test("missing, malformed, duplicate config and wrong types are rejected", () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.root, "config.json"));
    assert.throws(() => f.load(), /configFile/);
    write(f.root, "config.json", "{");
    assert.throws(() => f.load(), /malformed JSON/);
    write(f.root, "config.json", '{"schemaVersion":1,"schemaVersion":1}');
    assert.throws(() => f.load(), /duplicate key/);
    write(f.root, "config.json", "[]");
    assert.throws(() => f.load(), /object/);
  } finally {
    f.dispose();
  }
});
test("multiple matches, exact optional tags, and stable display-independent identity", () => {
  const f = fixture();
  try {
    f.config.metadata.matches.push("https://example.org/articles/*");
    Object.assign(f.config.metadata, {
      includes: ["https://example.net/public/*"],
      excludes: ["http://localhost/private/*"],
      connect: ["self", "example.org"],
      icon: "https://example.org/icon.png",
      source: "https://example.org/source",
      homepage: "https://example.org/",
      support: "https://example.org/help",
      updateURL: "https://example.org/core.meta.js",
      downloadURL: "https://example.org/core.user.js",
    });
    f.save();
    const project = f.load();
    const expected =
      "// ==UserScript==\n// @name Aperture Example\n// @namespace https://example.org/aperture\n// @version 0.1.0\n// @description Example project built with the preserved Aperture framework\n// @author Aperture contributors\n// @license MIT\n// @icon https://example.org/icon.png\n// @source https://example.org/source\n// @homepageURL https://example.org/\n// @supportURL https://example.org/help\n// @updateURL https://example.org/core.meta.js\n// @downloadURL https://example.org/core.user.js\n// @match http://localhost/*\n// @match https://example.org/articles/*\n// @include https://example.net/public/*\n// @exclude http://localhost/private/*\n// @connect self\n// @connect example.org\n// @grant GM.setValue\n// @grant GM.getValue\n// @grant GM.deleteValue\n// @run-at document-start\n// ==/UserScript==\n";
    assert.equal(header(project.metadata, "0.1.0"), expected);
    f.config.metadata.name = "Changed Display";
    f.save();
    const changed = f.load();
    assert.equal(changed.id, project.id);
    assert.equal(changed.storageNamespace, project.storageNamespace);
    assert.equal(changed.metadata.namespace, project.metadata.namespace);
    assert.equal(changed.build.outputName, project.build.outputName);
    const addonHeader = addonBuilder.headerForAddon(f.addonDocument.addons[0], {
      project,
      includeTimestamp: false,
    });
    assert.match(
      addonHeader,
      /@namespace\s+https:\/\/example.org\/aperture\/addons\/example-addon/,
    );
    assert.equal((addonHeader.match(/@match\s/g) || []).length, 1);
    assert.equal((addonHeader.match(/@grant\s/g) || []).length, 1);
    assert.doesNotMatch(
      addonHeader,
      /@include|@connect|@updateURL|@downloadURL/i,
    );
  } finally {
    f.dispose();
  }
});
test("original core builder modes preserve logging, outputs, theme and project-selected manifest; smoke is immutable", async () => {
  const f = fixture();
  try {
    const before = snapshot(f.root);
    const development = await coreBuilder.main(["--smoke"], {
      rootDir: f.root,
    });
    const repeated = await coreBuilder.main(["--smoke"], { rootDir: f.root });
    assert.deepEqual(development.artifacts, repeated.artifacts);
    const release = await coreBuilder.main(["--smoke", "--release"], {
      rootDir: f.root,
    });
    assert.equal(development.artifacts.length, 2);
    assert.equal(release.artifacts.length, 2);
    for (const artifact of development.artifacts) {
      const { context, logs } = execute(artifact.contents);
      assert.equal(logs.length, 3);
      assert.match(logs[0][0], /aperture-example.*fixture-development-log/);
      assert.equal(logs[2][0].fixture, true);
      assert.equal(context.fixtureResult.project.id, f.config.id);
      assert.equal(context.fixtureResult.framework.version, require("../package.json").version);
      assert.equal(context.fixtureResult.framework.name, "Aperture");
      assert.match(context.fixtureResult.theme, /#663399/);
      assert.deepEqual(Array.from(context.fixtureResult.features), [
        "fixture-feature",
      ]);
    }
    for (const artifact of release.artifacts) {
      const { context, logs } = execute(artifact.contents);
      assert.equal(logs.length, 0);
      assert.equal(context.fixtureResult.project.id, f.config.id);
      assert.equal(context.fixtureResult.framework.version, require("../package.json").version);
      assert.equal(context.fixtureResult.framework.name, "Aperture");
      assert.doesNotMatch(artifact.contents, /fixture-development-log/i);
    }
    assert.deepEqual(snapshot(f.root), before);
  } finally {
    f.dispose();
  }
});
test("normal builds keep versions; explicit bumps commit after successful preparation; failed bundling is immutable", async () => {
  const f = fixture();
  try {
    await coreBuilder.main(["--deterministic"], { rootDir: f.root });
    assert.equal(f.load().version.patch, 0);
    assert.equal(
      checkProjectFeatureManifest({ rootDir: f.root }).matches,
      true,
    );
    await coreBuilder.main(["--bump", "--deterministic"], { rootDir: f.root });
    assert.equal(f.load().version.patch, 1);
    write(f.root, "src/main.js", "import './missing-import.js';");
    const before = snapshot(f.root);
    await assert.rejects(
      coreBuilder.main(["--bump"], { rootDir: f.root }),
      /Build failed/,
    );
    assert.deepEqual(snapshot(f.root), before);
    await assert.rejects(
      coreBuilder.main(["--bump", "--no-bump"], { rootDir: f.root }),
      /conflicts/,
    );
  } finally {
    f.dispose();
  }
});
test("add-on build uses explicit metadata/constants, catalog hashing and cache; smoke and failed bundling leave state unchanged", async () => {
  const f = fixture();
  try {
    const before = snapshot(f.root);
    for (const flags of [["--smoke"], ["--smoke", "--release"]]) {
      const result = await addonBuilder.main(flags, { rootDir: f.root });
      const code = result.artifacts[0].contents;
      const addon = execute(code).context.fixtureAddon;
      assert.equal(addon.project.id, f.config.id);
      assert.equal(addon.name, f.addonDocument.addons[0].name);
      assert.deepEqual(Array.from(addon.scopes), ["example"]);
      assert.deepEqual(Array.from(addon.matches), ["http://localhost/*"]);
      assert.match(addon.theme, /#663399/);
    }
    assert.deepEqual(snapshot(f.root), before);
    const initial = await addonBuilder.main(["--deterministic"], {
      rootDir: f.root,
    });
    assert.equal(initial.artifacts.length, 1);
    assert.equal(
      catalog.checkCatalogArtifacts(catalog.readProjectManifest(f.load()), {
        project: f.load(),
      }),
      true,
    );
    assert.equal(
      (await addonBuilder.main(["--deterministic"], { rootDir: f.root }))
        .artifacts.length,
      0,
    );
    assert.equal(
      (
        await addonBuilder.main(["--release", "--deterministic"], {
          rootDir: f.root,
        })
      ).artifacts.length,
      1,
    );
    assert.equal(
      (await addonBuilder.main(["--deterministic"], { rootDir: f.root }))
        .artifacts.length,
      1,
    );
    const bumped = await addonBuilder.main(["--bump", "--deterministic"], {
      rootDir: f.root,
    });
    assert.match(bumped.artifacts[0].contents, /@version\s+0.1.1/);
    const current = catalog.readProjectManifest(f.load())[0];
    assert.equal(current.version, "0.1.1");
    assert.equal(
      catalog.buildTrustedCatalog([current])[0].matches[0],
      "http://localhost/*",
    );
    write(f.root, current.entry, "import './absent.js';");
    const failedBefore = snapshot(f.root);
    await assert.rejects(
      addonBuilder.main(["--bump"], { rootDir: f.root }),
      /Build failed/,
    );
    assert.deepEqual(snapshot(f.root), failedBefore);
  } finally {
    f.dispose();
  }
});
test("add-on validation refuses widening, scope/identity/path/permission errors before any output", async () => {
  const cases = [
    [
      (addon) => {
        addon.matches = ["*://*/*"];
      },
      /project match|narrower/,
    ],
    [
      (addon) => {
        addon.pageScopes = ["latest"];
      },
      /unsupported scope/,
    ],
    [
      (addon) => {
        addon.namespace = "https://example.org/x\n// @grant GM_download";
      },
      /single line/,
    ],
    [
      (addon) => {
        addon.version = "bad";
      },
      /version/,
    ],
    [
      (addon) => {
        addon.grants = ["GM_invented"];
      },
      /grant/,
    ],
    [
      (addon) => {
        addon.outfile = "src/main.js";
      },
      /outputDir/,
    ],
    [
      (addon) => {
        addon.outfile = "projects/example/dist/aperture-example.user.js";
      },
      /collision/,
    ],
    [
      (addon) => {
        addon.capabilities = ["secret"];
      },
      /capability/,
    ],
    [
      (addon) => {
        addon.capabilities = "toast";
      },
      /string array/,
    ],
    [
      (addon) => {
        addon.includes = ["https://other.org/*"];
      },
      /contained/,
    ],
    [
      (addon) => {
        addon.runtimeMode = "hybrid";
      },
      /standalone match/,
    ],
  ];
  for (const [change, expected] of cases) {
    const f = fixture();
    try {
      change(f.addonDocument.addons[0]);
      f.save();
      const before = snapshot(f.root);
      await assert.rejects(
        addonBuilder.main(["--bump"], { rootDir: f.root }),
        expected,
      );
      await assert.rejects(
        coreBuilder.main(["--bump"], { rootDir: f.root }),
        expected,
      );
      assert.deepEqual(snapshot(f.root), before);
    } finally {
      f.dispose();
    }
  }
});
test("custom theme selection and feature generation use the shared loader and original generator", () => {
  const f = fixture();
  try {
    write(f.root, "themes/custom/index.css", fs.readFileSync(path.join(ROOT, "themes/light/index.css"), "utf8"));
    f.config.theme = "custom";
    f.save();
    assert.match(f.load().themeCss, /#315ca8/);
    const generated = generateProjectFeatureManifest({ rootDir: f.root });
    assert.deepEqual(generated.featureNames, ["fixtureFeature"]);
    assert.equal(
      checkProjectFeatureManifest({ rootDir: f.root }).matches,
      true,
    );
    assert.match(
      fs.readFileSync(
        path.join(f.root, f.config.build.featureManifest),
        "utf8",
      ),
      /features\/fixture\/index.js/,
    );
  } finally {
    f.dispose();
  }
});
test("output transaction rolls back earlier files on write failure", () => {
  const f = fixture();
  try {
    write(f.root, "old.txt", "old");
    write(f.root, "not-a-directory", "block");
    const before = snapshot(f.root);
    assert.throws(() =>
      writeOutputs([
        { file: path.join(f.root, "old.txt"), contents: "new" },
        {
          file: path.join(f.root, "not-a-directory/output.txt"),
          contents: "fail",
        },
      ]),
    );
    assert.deepEqual(snapshot(f.root), before);
  } finally {
    f.dispose();
  }
});
test("release beautification failures cannot bump versions or commit prepared artifacts", async () => {
  const f = fixture(),
    terser = require("terser"),
    original = terser.minify;
  try {
    const before = snapshot(f.root);
    terser.minify = async () => {
      throw new Error("injected beautification failure");
    };
    await assert.rejects(
      coreBuilder.main(["--release", "--bump"], { rootDir: f.root }),
      /injected beautification failure/,
    );
    await assert.rejects(
      addonBuilder.main(["--release", "--bump"], { rootDir: f.root }),
      /injected beautification failure/,
    );
    assert.deepEqual(snapshot(f.root), before);
  } finally {
    terser.minify = original;
    f.dispose();
  }
});
test("theme and repository junction escapes are rejected before output", () => {
  const f = fixture(),
    outside = fixture();
  try {
    fs.symlinkSync(
      path.join(outside.root, "themes/default"),
      path.join(f.root, "themes/escaped"),
      "junction",
    );
    f.config.theme = "escaped";
    f.save();
    assert.throws(() => f.load(), /outside the repository/);
    write(
      f.root,
      "other-theme/index.css",
      "/* inside repository, outside approved themes root */",
    );
    fs.symlinkSync(
      path.join(f.root, "other-theme"),
      path.join(f.root, "themes/internal-escape"),
      "junction",
    );
    f.config.theme = "internal-escape";
    f.save();
    assert.throws(() => f.load(), /approved themes root/);
  } finally {
    f.dispose();
    outside.dispose();
  }
});
test("output junctions and malformed destination kinds are rejected", () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.root, "output-alias"), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(f.root, f.config.build.outputDir)), {
      recursive: true,
    });
    fs.symlinkSync(
      path.join(f.root, "output-alias"),
      path.join(f.root, f.config.build.outputDir),
      "junction",
    );
    assert.throws(() => f.load(), /output paths/);
    fs.unlinkSync(path.join(f.root, f.config.build.outputDir));
    write(f.root, f.config.build.outputDir, "not a directory");
    assert.throws(() => f.load(), /must be a directory/);
  } finally {
    f.dispose();
  }
});

test("settings inputs obey repository/source boundaries and cannot collide with application or generated outputs", () => {
  const f = fixture();
  try {
    for (const value of ["../outside/settings.js", "missing/settings.js", f.config.build.featureManifest, f.config.build.application]) {
      f.config.build.settings = value; f.save(); assert.throws(() => f.load());
    }
    f.config.build.settings = "projects/example/dist/settings.js";
    write(f.root, f.config.build.settings, "export default { schema: {} };"); f.save(); assert.throws(() => f.load(), /collision|generated directories/);
  } finally { f.dispose(); }
});


test('project config owns catalog update URLs, validates them, and supports local-only mode', () => {
  const f=fixture();try {
    for(const value of [false,[],{unknown:true},{catalogURL:''},{catalogURL:'file:///tmp/catalog.json'},{catalogURL:'https://user:pass@example.org/meta.json'},{catalogURL:'https://example.org/meta.json#x'}]) {
      f.config.addonUpdates=value;f.save();assert.throws(()=>f.load(),/addonUpdates/);
    }
    f.config.addonUpdates={};f.save();assert.deepEqual(f.load().addonUpdates,{});
    f.config.addonUpdates={catalogURL:'https://updates.example.org/catalog/meta.json?channel=stable'};f.save();assert.equal(f.load().addonUpdates.catalogURL,f.config.addonUpdates.catalogURL);
  }finally{f.dispose();}
});
