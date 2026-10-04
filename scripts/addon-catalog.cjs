const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadProject, configArgument, parseJson, metadata, repositoryPath, META } = require('./projectConfig.cjs');
const { writeOutputs } = require('../build/writeOutputs.cjs');

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PROJECT = loadProject({ rootDir: ROOT });
const MANIFEST_PATH = DEFAULT_PROJECT.resolved.addonsManifest;
const GENERATED_DIR = path.join(ROOT, "src", "generated");
const LEGACY_CATALOG_PATH = path.join(ROOT, "src", "services", "addons", "trusted-catalog.json");
const CATALOG_META_PATH = path.join(GENERATED_DIR, "trusted-addon-catalog.meta.json");
const CATALOG_FILE_PREFIX = "trusted-addon-catalog.";
const SUPPORTED_SCOPES = new Set(Object.keys(DEFAULT_PROJECT.routes).map(key => key.slice(2).toLowerCase()));
const RUNTIME_MODES = new Set(["core-required", "standalone", "hybrid"]);
const VALID_CAPABILITIES = new Set([
  "toast",
  "feature",
  "storage",
  "page",
  "idb",
  "observer",
  "ui",
  "ui.style",
  "ui.mount",
  "ui.dialog",
  "ui.dock",
]);
const VALID_RUN_AT = new Set(["document-start", "document-body", "document-end", "document-idle", "context-menu"]);


function sanitizeAddonId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function matchesPattern(url, pattern) {
  const normalized = String(pattern || "").trim();
  if (!normalized || normalized === "<all_urls>") return normalized === "<all_urls>";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const match = normalized.match(/^(\*|https?|file):\/\/([^/]+)(\/.*)?$/i);
  if (!match) return false;
  const [, scheme, hostPattern, pathPattern = "/*"] = match;
  if (scheme !== "*" && scheme.toLowerCase() !== parsed.protocol.slice(0, -1)) return false;
  const host = parsed.hostname.toLowerCase();
  const wantedHost = hostPattern.toLowerCase();
  if (wantedHost.startsWith("*.")) {
    const suffix = wantedHost.slice(1);
    if (host !== suffix.slice(1) && !host.endsWith(suffix)) return false;
  } else if (wantedHost !== "*" && wantedHost !== host) {
    return false;
  }
  const escapedPath = pathPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escapedPath}$`).test(`${parsed.pathname}${parsed.search}`);
}

function readManifest() {
  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  return Array.isArray(parsed.addons) ? parsed.addons : [];
}

function validateManifest(addons = readManifest(), { rootDir = ROOT, checkFiles = true, project = null } = {}) {
  const errors = [];
  const ids = new Set();
  const legacyIds = new Map();
  const root = path.resolve(rootDir);
  if (!Array.isArray(addons)) return ["addons: manifest must contain an array"];

  const addPathError = (index, field, message) => errors.push(`addons[${index}].${field}: ${message}`);
  const isRelativeRepositoryPath = (value) => {
    const normalized = String(value || "").replace(/\\/g, "/");
    return normalized && !normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized) && !normalized.includes("../");
  };

  for (const addon of addons) {
    const index = addons.indexOf(addon);
    const id = sanitizeAddonId(addon?.id);
    const scopes = Array.isArray(addon?.pageScopes)
      ? addon.pageScopes.map((scope) => String(scope || "").trim().toLowerCase())
      : null;
    const matches = Array.isArray(addon?.matches)
      ? addon.matches.map((match) => String(match || "").trim())
      : [];
    const mode = String(addon?.runtimeMode || "").trim().toLowerCase();
    if (!id) addPathError(index, "id", "missing add-on id");
    else if (ids.has(id)) addPathError(index, "id", `duplicate add-on id '${id}'`);
    ids.add(id);
    if (!RUNTIME_MODES.has(mode)) addPathError(index, "runtimeMode", `invalid runtime mode '${mode || "<missing>"}'`);
    if (!Array.isArray(scopes)) addPathError(index, "pageScopes", "must be an array");
    if (scopes?.some((scope) => !scope)) addPathError(index, "pageScopes", "contains an empty scope");
    if (scopes && new Set(scopes).size !== scopes.length) addPathError(index, "pageScopes", "contains duplicate scopes");
    const supportedScopes = project ? new Set(Object.keys(project.routes).map(key => key.slice(2).toLowerCase())) : SUPPORTED_SCOPES;
    if (scopes?.some((scope) => !supportedScopes.has(scope))) addPathError(index, "pageScopes", "contains an unsupported scope");
    if (mode !== "standalone" && scopes?.length === 0) addPathError(index, "pageScopes", "core mode requires at least one scope");
    if (mode === "standalone" && scopes?.length > 0) addPathError(index, "pageScopes", "standalone mode must not declare scopes");
    if (!Array.isArray(addon?.matches) || matches.length === 0) addPathError(index, "matches", "must contain at least one match");
    if (new Set(matches).size !== matches.length) addPathError(index, "matches", "contains duplicate matches");
    if (mode !== "standalone" && addon.requiresCore !== true) addPathError(index, "requiresCore", "must be true for core modes");
    if (mode === "standalone" && addon.requiresCore !== false) addPathError(index, "requiresCore", "must be false for standalone mode");
    if (matches.some((match) => !match || (!match.startsWith("<all_urls>") && !/^(\*|https?|file):\/\//i.test(match)))) {
      addPathError(index, "matches", "contains unsupported userscript match syntax");
    }

    const grants = Array.isArray(addon?.grants) ? addon.grants.map((grant) => String(grant || "").trim()) : null;
    if (!grants || grants.length === 0) addPathError(index, "grants", "must contain at least one grant");
    if (grants && new Set(grants).size !== grants.length) addPathError(index, "grants", "contains duplicate grants");
    if (grants?.includes("none") && grants.length !== 1) addPathError(index, "grants", "none must be used alone");
    if (grants?.some((grant) => grant !== "none" && !/^(?:GM_[A-Za-z0-9]+|GM\.[A-Za-z0-9]+)$/.test(grant))) {
      addPathError(index, "grants", "contains an unsupported grant");
    }

    if (!VALID_RUN_AT.has(String(addon?.runAt || "").trim())) {
      addPathError(index, "runAt", `unsupported run timing '${addon?.runAt || "<missing>"}'`);
    }
    if (!Array.isArray(addon?.capabilities)) addPathError(index, "capabilities", "must be an array");
    if (addon?.capabilities?.some((capability) => (!VALID_CAPABILITIES.has(String(capability || "").trim())))) {
      addPathError(index, "capabilities", "contains an unsupported capability");
    }
    if (addon?.capabilities && new Set(addon.capabilities).size !== addon.capabilities.length) {
      addPathError(index, "capabilities", "contains duplicate capabilities");
    }

    const expectedEntry = `addons/${id}/src/main.js`;
    const expectedOutfile = `addons/${id}/dist/${id}.user.js`;
    if (!project && addon?.entry !== expectedEntry) addPathError(index, "entry", `must be '${expectedEntry}'`);
    if (!project && addon?.outfile !== expectedOutfile) addPathError(index, "outfile", `must be '${expectedOutfile}'`);
    if (!isRelativeRepositoryPath(addon?.entry)) addPathError(index, "entry", "must be a relative repository path");
    if (!isRelativeRepositoryPath(addon?.outfile)) addPathError(index, "outfile", "must be a relative repository path");
    if (checkFiles && id && (project || addon?.entry === expectedEntry) && !fs.existsSync(path.join(root, addon.entry))) {
      addPathError(index, "entry", `file does not exist: ${expectedEntry}`);
    }

    const declaredLegacyIds = addon?.legacyIds;
    if (typeof declaredLegacyIds !== "undefined" && !Array.isArray(declaredLegacyIds)) {
      addPathError(index, "legacyIds", "must be an array when provided");
    }
    for (const legacyId of Array.isArray(declaredLegacyIds) ? declaredLegacyIds : []) {
      const normalizedLegacyId = sanitizeAddonId(legacyId);
      if (!normalizedLegacyId) addPathError(index, "legacyIds", "contains an empty ID");
      else if (String(legacyId || "").trim() !== normalizedLegacyId) {
        addPathError(index, "legacyIds", `must use sanitized ID '${normalizedLegacyId}'`);
      } else if (normalizedLegacyId === id || legacyIds.has(normalizedLegacyId)) {
        addPathError(index, "legacyIds", `duplicates add-on identity '${normalizedLegacyId}'`);
      } else {
        legacyIds.set(normalizedLegacyId, index);
      }
    }
  }
  const allIds = new Set(addons.map((addon) => String(addon?.id || "").trim()).filter(Boolean));
  const folderIds = new Set(
    addons
      .map((addon) => String(addon?.entry || "").replace(/\\/g, "/").match(/^addons\/([^/]+)\/src\/main\.js$/)?.[1])
      .filter(Boolean),
  );
  try {
    for (const entry of fs.readdirSync(path.join(root, "addons"), { withFileTypes: true })) {
      if (entry.isDirectory()) folderIds.add(sanitizeAddonId(entry.name));
    }
  } catch {
    // Temporary validator fixtures may not include an add-ons directory.
  }
  let catalogById = new Map();
  if (checkFiles) {
    try {
      const existingCatalog = JSON.parse(fs.readFileSync(
        path.join(project ? project.resolved.catalogDir : path.join(root, 'src', 'generated'), "trusted-addon-catalog.meta.json"),
        "utf8",
      ));
      const catalogFile = String(existingCatalog?.catalogFile || "");
      const catalogDocument = JSON.parse(fs.readFileSync(path.join(project ? project.resolved.catalogDir : path.join(root, 'src', 'generated'), catalogFile), "utf8"));
      catalogById = new Map((Array.isArray(catalogDocument?.catalog) ? catalogDocument.catalog : [])
        .map((entry) => [sanitizeAddonId(entry?.id), entry]).filter(([id]) => id));
    } catch {
      catalogById = new Map();
    }
  }
  for (const [legacyId, ownerIndex] of legacyIds) {
    const owner = addons[ownerIndex];
    const previousCatalogEntry = catalogById.get(legacyId);
    const isSamePublishedScript = previousCatalogEntry &&
      String(previousCatalogEntry.downloadUrl || "") === String(owner?.downloadUrl || "");
    if (allIds.has(legacyId) || folderIds.has(legacyId) || (previousCatalogEntry && !isSamePublishedScript)) {
      addPathError(ownerIndex, "legacyIds", `duplicates add-on identity '${legacyId}'`);
    }
  }
  for (const [legacyId, ownerIndex] of legacyIds) {
    const owner = addons[ownerIndex];
    if (owner?.legacyIds?.filter((value) => String(value || "").trim() === legacyId).length > 1) {
      addPathError(ownerIndex, "legacyIds", `duplicates legacy ID '${legacyId}'`);
    }
  }
  const header = "";
  if (header.includes("trustedAddonCatalog") || header.includes("GM_getResourceText")) {
    errors.push("core header must not embed the trusted catalog resource");
  }
  return errors;
}

// Conservative containment: grant no wider scheme/host/path than the configured
// core. Complex glob inclusion is rejected rather than guessed or widened.
function isNarrowerMatch(candidate, parent) {
  const split = value => value.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/i);
  const child = split(candidate), core = split(parent); if (!child || !core) return false;
  if (core[1] !== '*' && child[1] !== core[1]) return false;
  const hostFits = core[2] === '*' || child[2] === core[2] || (core[2].startsWith('*.') && (child[2] === core[2].slice(2) || child[2].endsWith(core[2].slice(1))));
  if (!hostFits) return false;
  if (child[3] === core[3]) return true;
  if (!core[3].endsWith('*') || core[3].slice(0, -1).includes('*')) return false;
  const prefix = core[3].slice(0, -1);
  const firstWildcard = child[3].indexOf('*');
  return child[3].startsWith(prefix) && (firstWildcard < 0 || firstWildcard >= prefix.length);
}
function addonMetadata(addon, project) {
  const result = { ...project.metadata };
  // Activation permissions are explicit per add-on; never inherit include/connect
  // or grants. Other display and public URL fields may use project defaults.
  for (const key of ['includes', 'excludes', 'connect', 'updateURL', 'downloadURL']) delete result[key];
  for (const key of META) if (addon[key] !== undefined) result[key] = addon[key];
  result.namespace = addon.namespace || `${project.metadata.namespace.replace(/\/$/, '')}/addons/${addon.id}`;
  if (addon.downloadUrl !== undefined) result.downloadURL = addon.downloadUrl;
  return result;
}
function readProjectManifest(project) {
  const document = parseJson(fs.readFileSync(project.resolved.addonsManifest, 'utf8'), 'addonsManifest');
  if (!document || Array.isArray(document) || typeof document !== 'object' || Object.keys(document).some(key => key !== 'addons') || !Array.isArray(document.addons)) throw new Error('addonsManifest: requires an object with an addons array');
  const reserved = [project.configPath, project.resolved.entry, project.resolved.versionFile, project.resolved.addonsManifest, project.resolved.theme, project.resolved.featureManifest, project.resolved.cacheFile, ...['user.js', 'uglified.user.js'].map(suffix => path.join(project.resolved.outputDir, `${project.build.outputName}.${suffix}`))];
  const outputs = new Set(reserved.map(file => file.toLowerCase()));
  document.addons.forEach((addon, index) => {
    const field = `addons[${index}]`;
    if (!addon || Array.isArray(addon) || typeof addon !== 'object') throw new Error(`${field}: requires an object`);
    const allowed = [...META, 'id', 'version', 'entry', 'outfile', 'pageScopes', 'runtimeMode', 'requiresCore', 'capabilities', 'legacyIds', 'downloadUrl'];
    for (const key of Object.keys(addon)) if (!allowed.includes(key)) throw new Error(`${field}.${key}: unknown field`);
    if (!/^[a-z][a-z0-9_-]{1,63}$/.test(addon.id || '')) throw new Error(`${field}.id: invalid machine identifier`);
    for (const key of ['name', 'description', 'matches', 'grants', 'runAt']) if (addon[key] === undefined) throw new Error(`${field}.${key}: required`);
    for (const key of ['pageScopes', 'capabilities', 'legacyIds']) {
      if (key === 'legacyIds' && addon[key] === undefined) continue;
      if (!Array.isArray(addon[key]) || addon[key].some(value => typeof value !== 'string')) throw new Error(`${field}.${key}: requires a string array`);
    }
    if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(addon.version || '') || addon.version.split('.').some(value => !Number.isSafeInteger(+value))) throw new Error(`${field}.version: requires a numeric three-part version`);
    metadata(addonMetadata(addon, project), field);
    if (addon.downloadURL !== undefined && addon.downloadUrl !== undefined && addon.downloadURL !== addon.downloadUrl) throw new Error(`${field}.downloadURL: conflicts with downloadUrl`);
    const entry = repositoryPath(project.rootDir, addon.entry, `${field}.entry`, { exists: true });
    const outfile = repositoryPath(project.rootDir, addon.outfile, `${field}.outfile`, { writable: true });
    if (!outfile.startsWith(project.resolved.outputDir + path.sep) || !outfile.endsWith('.user.js')) throw new Error(`${field}.outfile: must be a .user.js file within project outputDir`);
    if (entry.startsWith(project.resolved.outputDir + path.sep) || entry.startsWith(project.resolved.catalogDir + path.sep) || entry === outfile) throw new Error(`${field}.entry: generated outputs cannot be source inputs`);
    if (outputs.has(outfile.toLowerCase()) || document.addons.some(other => path.resolve(project.rootDir, other.entry || '').toLowerCase() === outfile.toLowerCase())) throw new Error(`${field}.outfile: output collision`);
    outputs.add(outfile.toLowerCase());
    if (addon.runtimeMode !== 'standalone' && !addon.matches.some(candidate => project.metadata.matches.some(parent => isNarrowerMatch(candidate, parent)))) throw new Error(`${field}.matches: core modes require a project match`);
    if (addon.runtimeMode === 'core-required' && addon.matches.some(candidate => !project.metadata.matches.some(parent => isNarrowerMatch(candidate, parent)))) throw new Error(`${field}.matches: core-required permissions must be narrower than project matches`);
    if (addon.runtimeMode === 'core-required' && (project.metadata.excludes || []).some(excluded => !(addon.excludes || []).includes(excluded))) throw new Error(`${field}.excludes: must explicitly preserve core project exclusions`);
    if (addon.runtimeMode === 'hybrid' && !addon.matches.some(candidate => !project.metadata.matches.some(parent => isNarrowerMatch(candidate, parent)))) throw new Error(`${field}.matches: hybrid requires an explicit standalone match`);
    if (addon.includes?.some(candidate => !addon.matches.some(parent => isNarrowerMatch(candidate, parent)))) throw new Error(`${field}.includes: must be contained by explicit add-on matches`);
  });
  const errors = validateManifest(document.addons, { rootDir: project.rootDir, project });
  if (errors.length) throw new Error(errors.join('\n'));
  return document.addons;
}

function buildTrustedCatalog(addons = readManifest()) {
  return [...addons]
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((addon) => ({
      id: addon.id,
      name: addon.name,
      description: addon.description,
      version: addon.version,
      pageScopes: [...addon.pageScopes],
      runtimeMode: addon.runtimeMode,
      matches: [...addon.matches],
      grants: [...addon.grants],
      runAt: addon.runAt,
      requiresCore: Boolean(addon.requiresCore),
      capabilities: [...addon.capabilities],
      downloadUrl: String(addon.downloadURL || addon.downloadUrl || ""),
      trusted: true,
      ...(Array.isArray(addon.legacyIds) && addon.legacyIds.length > 0
        ? { legacyIds: [...new Set(addon.legacyIds.map((value) => sanitizeAddonId(value)).filter(Boolean))].sort() }
        : {}),
    }));
}

function renderCatalog(addons = readManifest()) {
  return `${JSON.stringify(buildTrustedCatalog(addons), null, 2)}\n`;
}

function buildCatalogArtifacts(addons = readManifest()) {
  const catalog = buildTrustedCatalog(addons);
  const canonical = JSON.stringify(catalog);
  const identifier = crypto.createHash("sha256").update(canonical).digest("hex");
  const catalogFile = `${CATALOG_FILE_PREFIX}${identifier.slice(0, 16)}.json`;
  return {
    identifier,
    catalogFile,
    metadata: `${JSON.stringify({ schemaVersion: 1, identifier, catalogFile }, null, 2)}\n`,
    catalog: `${JSON.stringify({ schemaVersion: 1, identifier, catalog }, null, 2)}\n`,
    aliases: `${JSON.stringify(Object.fromEntries(catalog.flatMap((entry) =>
      (entry.legacyIds || []).map((legacyId) => [legacyId, entry.id]))), null, 2)}\n`,
  };
}

function catalogOutputs(addons, project) {
  const artifacts = buildCatalogArtifacts(addons), generatedDir = project.resolved.catalogDir;
  const entries = [
    { file: path.join(generatedDir, artifacts.catalogFile), contents: artifacts.catalog },
    { file: path.join(generatedDir, 'trusted-addon-catalog.meta.json'), contents: artifacts.metadata },
    { file: path.join(generatedDir, 'trusted-addon-aliases.json'), contents: artifacts.aliases },
    { file: path.join(generatedDir, 'trusted-catalog.json'), contents: renderCatalog(addons) },
  ];
  if (fs.existsSync(generatedDir)) for (const name of fs.readdirSync(generatedDir)) {
    if (/^trusted-addon-catalog\.[a-f0-9]{16}\.json$/.test(name) && name !== artifacts.catalogFile) entries.push({ file: path.join(generatedDir, name), contents: null });
  }
  for (const entry of entries) repositoryPath(project.rootDir, path.relative(project.rootDir, entry.file).replace(/\\/g, '/'), 'catalog.output', { writable: true });
  return entries;
}
function writeCatalogArtifacts(addons = readManifest(), { rootDir = ROOT, project = null } = {}) {
  if (project) { writeOutputs(catalogOutputs(addons, project)); return buildCatalogArtifacts(addons); }
  const generatedDir = path.join(rootDir, "src", "generated");
  const artifacts = buildCatalogArtifacts(addons);
  fs.mkdirSync(generatedDir, { recursive: true });
  for (const name of fs.readdirSync(generatedDir)) {
    if (name.startsWith(CATALOG_FILE_PREFIX) && name.endsWith(".json") && name !== artifacts.catalogFile) {
      fs.rmSync(path.join(generatedDir, name));
    }
  }
  fs.writeFileSync(path.join(generatedDir, artifacts.catalogFile), artifacts.catalog);
  fs.writeFileSync(path.join(generatedDir, "trusted-addon-catalog.meta.json"), artifacts.metadata);
  fs.writeFileSync(path.join(generatedDir, "trusted-addon-aliases.json"), artifacts.aliases);
  const legacyPath = path.join(rootDir, path.relative(ROOT, LEGACY_CATALOG_PATH));
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  fs.writeFileSync(legacyPath, renderCatalog(addons));
  return artifacts;
}

function checkCatalogArtifacts(addons = readManifest(), { rootDir = ROOT, project = null } = {}) {
  if (project) return catalogOutputs(addons, project).every(entry => entry.contents === null ? !fs.existsSync(entry.file) : fs.existsSync(entry.file) && fs.readFileSync(entry.file, 'utf8') === entry.contents);
  const generatedDir = path.join(rootDir, "src", "generated");
  const expected = buildCatalogArtifacts(addons);
  const metadataPath = path.join(generatedDir, "trusted-addon-catalog.meta.json");
  const catalogPath = path.join(generatedDir, expected.catalogFile);
  if (!fs.existsSync(metadataPath) || fs.readFileSync(metadataPath, "utf8") !== expected.metadata) return false;
  if (!fs.existsSync(catalogPath) || fs.readFileSync(catalogPath, "utf8") !== expected.catalog) return false;
  if (fs.readFileSync(path.join(generatedDir, "trusted-addon-aliases.json"), "utf8") !== expected.aliases) return false;
  const legacyPath = path.join(rootDir, path.relative(ROOT, LEGACY_CATALOG_PATH));
  if (!fs.existsSync(legacyPath) || fs.readFileSync(legacyPath, "utf8") !== renderCatalog(addons)) return false;
  return fs.readdirSync(generatedDir)
    .filter((name) => name.startsWith(CATALOG_FILE_PREFIX) && name.endsWith(".json") && name !== "trusted-addon-catalog.meta.json")
    .every((name) => name === expected.catalogFile);
}

function run(args = process.argv.slice(2)) {
  const project = loadProject({ configFile: configArgument(args) });
  const addons = readProjectManifest(project);
  const errors = validateManifest(addons, { project, rootDir: project.rootDir });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (args.includes("--check-manifest")) {
    console.log("Add-on manifest validation passed.");
    return;
  }
  if (args.includes("--write")) {
    const artifacts = writeCatalogArtifacts(addons, { project });
    console.log(`Generated trusted add-on catalog ${artifacts.catalogFile}.`);
    return;
  }
  if (args.includes("--check")) {
    if (!checkCatalogArtifacts(addons, { project })) throw new Error("Generated trusted catalog artifacts differ from the selected project manifest.");
    console.log("Trusted catalog is in sync with the add-on manifest.");
    return;
  }
  console.log(buildCatalogArtifacts(addons).catalog);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(`Add-on catalog check failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildTrustedCatalog,
  buildCatalogArtifacts,
  checkCatalogArtifacts,
  readManifest,
  renderCatalog,
  writeCatalogArtifacts,
  run,
  validateManifest,
  readProjectManifest,
  addonMetadata,
  isNarrowerMatch,
  catalogOutputs,
};
