const fs = require("fs");
const path = require("path");

const RUN_AT = new Set([
  "document-start",
  "document-body",
  "document-end",
  "document-idle",
  "context-menu",
]);
const GRANTS = new Set([
  "none",
  "unsafeWindow",
  ...[
    "getValue",
    "setValue",
    "deleteValue",
    "listValues",
    "getValues",
    "setValues",
    "deleteValues",
    "addValueChangeListener",
    "removeValueChangeListener",
    "xmlhttpRequest",
    "download",
    "registerMenuCommand",
    "unregisterMenuCommand",
    "notification",
    "setClipboard",
    "openInTab",
    "addStyle",
    "addElement",
    "getResourceText",
    "getResourceURL",
    "getResourceUrl",
    "info",
    "log",
  ].flatMap((name) => [`GM_${name}`, `GM.${name}`]),
]);
const META = [
  "name",
  "namespace",
  "description",
  "author",
  "license",
  "matches",
  "grants",
  "runAt",
  "icon",
  "source",
  "homepage",
  "support",
  "updateURL",
  "downloadURL",
  "includes",
  "excludes",
  "connect",
];
function fail(field, message) {
  throw new Error(`${field}: ${message}`);
}
function object(value, field, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(field, "must be an object");
  for (const key of Object.keys(value))
    if (!keys.includes(key)) fail(`${field}.${key}`, "unknown field");
}
function line(value, field) {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /[\x00-\x1f\x7f\u2028\u2029]/.test(value)
  )
    fail(
      field,
      "must be a nonempty single line without surrounding whitespace",
    );
  return value;
}
function list(value, field, validate, required = false) {
  if (!Array.isArray(value) || (required && !value.length))
    fail(field, "must be a nonempty array");
  const seen = new Set();
  value.forEach((item, index) => {
    line(item, `${field}[${index}]`);
    validate(item, `${field}[${index}]`);
    if (seen.has(item)) fail(field, "duplicate value");
    seen.add(item);
  });
}
function url(value, field) {
  line(value, field);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(field, "invalid URL");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    fail(field, "requires an HTTP(S) URL without credentials");
}
function match(value, field) {
  line(value, field);
  if (
    !/^(?:https?|\*):\/\/(?:\*|(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?\/[^\s#]*$/i.test(
      value,
    )
  )
    fail(field, "unsupported HTTP(S) match pattern");
  const authority = value.split("/")[2];
  if (authority.includes("..") || /(?:^|\.)-|-\./.test(authority))
    fail(field, "invalid match host");
  const port = authority.match(/:(\d+)$/);
  if (port && (+port[1] < 1 || +port[1] > 65535)) fail(field, "invalid port");
}
function metadata(value, field = "metadata") {
  object(value, field, META);
  for (const name of ["name", "namespace", "description", "author", "license"])
    line(value[name], `${field}.${name}`);
  url(value.namespace, `${field}.namespace`);
  list(value.matches, `${field}.matches`, match, true);
  list(
    value.grants,
    `${field}.grants`,
    (grant, location) => {
      if (!GRANTS.has(grant)) fail(location, "unsupported grant");
    },
    true,
  );
  if (value.grants.includes("none") && value.grants.length !== 1)
    fail(`${field}.grants`, "none must be used alone");
  if (!RUN_AT.has(value.runAt))
    fail(`${field}.runAt`, "unsupported run timing");
  for (const name of [
    "icon",
    "source",
    "homepage",
    "support",
    "updateURL",
    "downloadURL",
  ])
    if (value[name] !== undefined) url(value[name], `${field}.${name}`);
  for (const name of ["includes", "excludes"])
    if (value[name] !== undefined) list(value[name], `${field}.${name}`, match);
  if (value.connect !== undefined)
    list(value.connect, `${field}.connect`, (host, location) => {
      if (
        !/^(?:\*|self|localhost|(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.test(
          host,
        ) ||
        host.includes("..")
      )
        fail(location, "invalid connect host");
    });
  for (const excluded of value.excludes || [])
    if (
      value.matches.includes(excluded) ||
      (value.includes || []).includes(excluded)
    )
      fail(`${field}.excludes`, "conflicts with an activation pattern");
  return value;
}

// JSON.parse accepts duplicate object keys. Walk its already syntax-checked token stream
// to reject them, including escaped spellings, rather than choosing the last value.
function parseJson(text, field = "config") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(field, `malformed JSON (${error.message})`);
  }
  const tokens =
    text.match(
      /"(?:\\.|[^"\\])*"|[{}\[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
    ) || [];
  let offset = 0;
  function walk(location) {
    const token = tokens[offset++];
    if (token === "{") {
      const keys = new Set();
      while (tokens[offset] !== "}") {
        const key = JSON.parse(tokens[offset++]);
        offset++;
        if (keys.has(key)) fail(`${location}.${key}`, "duplicate key");
        keys.add(key);
        walk(`${location}.${key}`);
        if (tokens[offset] === ",") offset++;
      }
      offset++;
    } else if (token === "[") {
      let index = 0;
      while (tokens[offset] !== "]") {
        walk(`${location}[${index++}]`);
        if (tokens[offset] === ",") offset++;
      }
      offset++;
    }
  }
  walk(field);
  return parsed;
}
function repositoryPath(
  root,
  value,
  field,
  { exists = false, directory = false, writable = false } = {},
) {
  line(value, field);
  if (
    value.includes("\\") ||
    value.includes(":") ||
    path.isAbsolute(value) ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      ) ||
    /[<>"|?*]/.test(value)
  )
    fail(field, "requires a safe repository-relative POSIX path");
  if (
    value
      .split("/")
      .some((part) =>
        ["node_modules", ".git", ".baseline"].includes(part.toLowerCase()),
      )
  )
    fail(field, "reserved directory");
  const target = path.resolve(root, value);
  let ancestor = target;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const realRoot = fs.realpathSync(root),
    realAncestor = fs.realpathSync(ancestor);
  const relative = path.relative(realRoot, realAncestor);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    fail(field, "resolves outside the repository");
  if (writable) {
    for (
      let current = ancestor;
      current !== path.resolve(root);
      current = path.dirname(current)
    ) {
      if (fs.lstatSync(current).isSymbolicLink())
        fail(field, "output paths must not use symbolic links or junctions");
    }
  }
  if (
    fs.existsSync(target) &&
    (directory
      ? !fs.statSync(target).isDirectory()
      : !fs.statSync(target).isFile())
  )
    fail(field, directory ? "must be a directory" : "must be a file");
  if (
    exists &&
    (!fs.existsSync(target) ||
      (directory
        ? !fs.statSync(target).isDirectory()
        : !fs.statSync(target).isFile()))
  )
    fail(field, directory ? "directory does not exist" : "file does not exist");
  return target;
}
function readVersion(file) {
  const value = parseJson(fs.readFileSync(file, "utf8"), "version");
  object(value, "version", ["major", "minor", "patch"]);
  for (const key of ["major", "minor", "patch"])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0)
      fail(`version.${key}`, "requires a nonnegative safe integer");
  return value;
}
function configArgument(args, fallback = "config.json") {
  const positions = args.flatMap((arg, index) =>
    arg === "--config" ? [index] : [],
  );
  if (positions.length > 1) fail("--config", "specified twice");
  if (!positions.length) return fallback;
  const value = args[positions[0] + 1];
  if (!value || value.startsWith("--")) fail("--config", "missing path");
  return value;
}
function loadProject({
  rootDir = path.resolve(__dirname, ".."),
  configFile = "config.json",
} = {}) {
  const root = path.resolve(rootDir);
  const configPath = repositoryPath(root, configFile, "configFile", {
    exists: true,
  });
  const config = parseJson(fs.readFileSync(configPath, "utf8"));
  object(config, "config", [
    "schemaVersion",
    "id",
    "storageNamespace",
    "metadata",
    "build",
    "routes",
    "theme",
    "addonUpdates",
  ]);
  if (config.schemaVersion !== 1) fail("schemaVersion", "must be 1");
  for (const key of ["id", "storageNamespace"])
    if (
      typeof config[key] !== "string" ||
      !/^[a-z][a-z0-9_-]{1,63}$/.test(config[key])
    )
      fail(key, "requires a lowercase machine identifier (2–64 characters)");
  metadata(config.metadata);
  if (config.addonUpdates !== undefined) {
    object(config.addonUpdates, "addonUpdates", ["catalogURL"]);
    if (config.addonUpdates.catalogURL !== undefined) {
      url(config.addonUpdates.catalogURL, "addonUpdates.catalogURL");
      if (new URL(config.addonUpdates.catalogURL).hash) fail("addonUpdates.catalogURL", "must not contain a fragment");
    }
  }
  object(config.build, "build", [
    "application",
    "addons",
    "settings",
    "ui",
    "entry",
    "featuresDir",
    "featureManifest",
    "versionFile",
    "outputDir",
    "outputName",
    "addonsManifest",
    "catalogDir",
    "cacheFile",
  ]);
  const resolved = {};
  for (const key of [
    "entry",
    "featuresDir",
    "featureManifest",
    "versionFile",
    "outputDir",
    "addonsManifest",
    "catalogDir",
    "cacheFile",
  ])
    resolved[key] = repositoryPath(root, config.build[key], `build.${key}`, {
      exists: [
        "entry",
        "featuresDir",
        "versionFile",
        "addonsManifest",
      ].includes(key),
      directory: ["featuresDir", "outputDir", "catalogDir"].includes(key),
      writable: !["entry", "featuresDir"].includes(key),
    });
  if (config.build.addons !== undefined) resolved.addons = repositoryPath(root, config.build.addons, "build.addons", { exists: true });
  if (config.build.application !== undefined)
    resolved.application = repositoryPath(root, config.build.application, "build.application", { exists: true });
  if (config.build.ui !== undefined) resolved.ui = repositoryPath(root, config.build.ui, "build.ui", { exists: true });
  if (config.build.settings !== undefined)
    resolved.settings = repositoryPath(root, config.build.settings, "build.settings", { exists: true });
  if (!/^[a-z][a-z0-9_-]*$/.test(config.build.outputName || ""))
    fail("build.outputName", "requires a lowercase filename stem");
  object(config.routes, "routes", Object.keys(config.routes || {}));
  if (!Object.keys(config.routes).length)
    fail("routes", "at least one declaration is required");
  for (const [name, rule] of Object.entries(config.routes)) {
    if (!/^is[A-Z][A-Za-z0-9]*$/.test(name))
      fail(`routes.${name}`, "requires an isName page definition key");
    object(rule, `routes.${name}`, ["hostIncludes", "hostEquals", "pathStartsWith", "pathEquals", "hrefIncludes", "pathPattern"]);
    const hostField = rule.hostIncludes !== undefined ? "hostIncludes" : "hostEquals";
    list(
      rule[hostField],
      `routes.${name}.${hostField}`,
      (host, location) => {
        if (!/^[a-z0-9.-]+$/i.test(host)) fail(location, "invalid host");
      },
      true,
    );
    for (const field of ["hostEquals", "pathEquals", "hrefIncludes", "pathPattern"])
      if (rule[field] !== undefined) list(rule[field], `routes.${name}.${field}`, (value, location) => {
        if (field === "hostEquals" && !/^[a-z0-9.-]+$/i.test(value)) fail(location, "invalid host");
        if (field === "pathEquals" && !value.startsWith("/")) fail(location, "requires a path starting with /");
        if (field === "pathPattern") { try { new RegExp(value); } catch { fail(location, "invalid regular expression"); } }
      }, true);
    if (rule.pathStartsWith !== undefined)
      list(
        rule.pathStartsWith,
        `routes.${name}.pathStartsWith`,
        (prefix, location) => {
          if (!prefix.startsWith("/"))
            fail(location, "requires a path starting with /");
        },
        true,
      );
  }
  if (!/^[a-z][a-z0-9_-]*$/.test(config.theme || ""))
    fail("theme", "requires a theme directory name");
  repositoryPath(root, "themes/default/index.css", "theme.default", {
    exists: true,
  });
  resolved.theme = repositoryPath(
    root,
    `themes/${config.theme}/index.css`,
    "theme.selected",
    { exists: true },
  );
  require("./themeContract.cjs").validateTheme(fs.readFileSync(path.join(root, "themes/default/index.css"), "utf8"), "theme.default");
  const themeRoot = fs.realpathSync(path.join(root, "themes"));
  for (const theme of [
    resolved.theme,
    path.join(root, "themes/default/index.css"),
  ]) {
    const relative = path.relative(themeRoot, fs.realpathSync(theme));
    if (relative.startsWith("..") || path.isAbsolute(relative))
      fail("theme", "must resolve within the approved themes root");
  }
  const outputFiles = [
    resolved.featureManifest,
    resolved.cacheFile,
    ...["user.js", "uglified.user.js"].map((suffix) =>
      path.join(resolved.outputDir, `${config.build.outputName}.${suffix}`),
    ),
  ];
  for (const file of outputFiles)
    repositoryPath(
      root,
      path.relative(root, file).replace(/\\/g, "/"),
      "build.output",
      { writable: true },
    );
  if (resolved.addons && [resolved.settings, resolved.application, resolved.ui].filter(Boolean).some(file => file.toLowerCase() === resolved.addons.toLowerCase())) fail("build.addons", "add-on policy source collision");
  if (resolved.ui && [resolved.settings, resolved.application].filter(Boolean).some(file => file.toLowerCase() === resolved.ui.toLowerCase())) fail("build.ui", "UI source collision");
  if (resolved.settings && resolved.application && resolved.settings.toLowerCase() === resolved.application.toLowerCase()) fail("build.settings", "application/settings source collision");
  const sources = [
    configPath,
    resolved.entry,
    ...(resolved.application ? [resolved.application] : []),
    ...(resolved.settings ? [resolved.settings] : []),
    ...(resolved.ui ? [resolved.ui] : []),
    ...(resolved.addons ? [resolved.addons] : []),
    resolved.versionFile,
    resolved.addonsManifest,
    resolved.theme,
  ];
  const within = (parent, child) =>
    child.toLowerCase() === parent.toLowerCase() ||
    child.toLowerCase().startsWith(parent.toLowerCase() + path.sep);
  for (const source of sources)
    if (
      within(resolved.outputDir, source) ||
      within(resolved.catalogDir, source) ||
      outputFiles.some((file) => file.toLowerCase() === source.toLowerCase())
    )
      fail("build", "output/source collision");
  if (
    within(resolved.featuresDir, resolved.outputDir) ||
    within(resolved.featuresDir, resolved.catalogDir) ||
    outputFiles.some((file) => within(resolved.featuresDir, file))
  )
    fail("build", "generated outputs must not be feature inputs");
  if (
    within(resolved.outputDir, resolved.catalogDir) ||
    within(resolved.catalogDir, resolved.outputDir)
  )
    fail("build", "catalog/output directory collision");
  if (
    within(resolved.outputDir, resolved.featuresDir) ||
    within(resolved.catalogDir, resolved.featuresDir)
  )
    fail("build.featuresDir", "generated directories cannot be source inputs");
  if (
    sources.some((source) => within(resolved.catalogDir, source)) ||
    outputFiles.some((file) => within(resolved.catalogDir, file))
  )
    fail("build.catalogDir", "catalog/source or generated-output collision");
  for (const key of ["entry", "featuresDir", ...(resolved.application ? ["application"] : []), ...(resolved.settings ? ["settings"] : []), ...(resolved.ui ? ["ui"] : []), ...(resolved.addons ? ["addons"] : [])])
    if (
      config.build[key]
        .split("/")
        .some((part) => ["dist", "generated"].includes(part.toLowerCase()))
    )
      fail(`build.${key}`, "generated directories cannot be source inputs");
  if (
    new Set(outputFiles.map((file) => file.toLowerCase())).size !==
    outputFiles.length
  )
    fail("build", "output collision");
  return {
    ...config,
    rootDir: root,
    configPath,
    resolved,
    version: readVersion(resolved.versionFile),
    themeCss: require("./themeContract.cjs").validateTheme(fs.readFileSync(resolved.theme, "utf8"), "theme.selected").css,
  };
}
function header(
  metadataValue,
  version,
  {
    name = metadataValue.name,
    banner = "",
    buildInfo = "",
    align = false,
  } = {},
) {
  metadata(metadataValue);
  const rows = ["// ==UserScript=="];
  const tag = (key, value) => {
    if (value !== undefined)
      rows.push(`// @${align ? key.padEnd(13) : key + " "}${value}`);
  };
  tag("name", line(name, "header.name"));
  tag("namespace", metadataValue.namespace);
  tag("version", line(version, "header.version"));
  for (const key of ["description", "author", "license", "icon"])
    tag(key, metadataValue[key]);
  for (const [key, source] of [
    ["source", "source"],
    ["homepageURL", "homepage"],
    ["supportURL", "support"],
    ["updateURL", "updateURL"],
    ["downloadURL", "downloadURL"],
  ])
    tag(key, metadataValue[source]);
  for (const [key, source] of [
    ["match", "matches"],
    ["include", "includes"],
    ["exclude", "excludes"],
    ["connect", "connect"],
    ["grant", "grants"],
  ])
    for (const value of metadataValue[source] || []) tag(key, value);
  tag("run-at", metadataValue.runAt);
  rows.push("// ==/UserScript==", banner, buildInfo, "");
  return rows
    .filter((row, index) => row || index === rows.length - 1)
    .join("\n");
}
module.exports = {
  loadProject,
  parseJson,
  repositoryPath,
  metadata,
  match,
  readVersion,
  configArgument,
  header,
  META,
  GRANTS,
};
