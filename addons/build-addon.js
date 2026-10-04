const esbuild = require("esbuild");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require('os');
const { normalizedTextAssets } = require("../scripts/normalize-text-assets.cjs");
const { createStripDebugLogs } = require("../build/stripDebugLogs");
const { validateManifest, readProjectManifest, addonMetadata, catalogOutputs } = require("../scripts/addon-catalog.cjs");
const { loadProject, configArgument, header: projectHeader } = require('../scripts/projectConfig.cjs');
const { publicProject, projectInputs } = require('../build/projectInputs.cjs');
const { writeOutputs } = require('../build/writeOutputs.cjs');
let terser = null;
try {
  terser = require("terser");
} catch {
  terser = null;
}

const ROOT = __dirname ? path.resolve(__dirname, "..") : process.cwd();
const MANIFEST_PATH = loadProject({ rootDir: ROOT }).resolved.addonsManifest;
const CACHE_FILE = loadProject({ rootDir: ROOT }).resolved.cacheFile;

function readBuildCache(cacheFile = CACHE_FILE) {
  if (!fs.existsSync(cacheFile)) {
    return { addons: {} };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return {
      addons: parsed?.addons && typeof parsed.addons === "object" ? parsed.addons : {},
    };
  } catch {
    return { addons: {} };
  }
}

function writeBuildCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function parseVersion(versionStr) {
  const parts = String(versionStr || "0.0.0").split(".");
  return {
    major: Number(parts[0] || 0),
    minor: Number(parts[1] || 0),
    patch: Number(parts[2] || 0),
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpVersion(versionStr, bumpType) {
  const current = parseVersion(versionStr);
  if (bumpType === "major") {
    return { major: current.major + 1, minor: 0, patch: 0 };
  }
  if (bumpType === "minor") {
    return { major: current.major, minor: current.minor + 1, patch: 0 };
  }
  return { major: current.major, minor: current.minor, patch: current.patch + 1 };
}

function getBumpType(args) {
  if (args.includes("--major")) return "major";
  if (args.includes("--minor")) return "minor";
  return "patch";
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function collectFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function computeAddonHash(addon, isRelease, project = null) {
  const root = project ? project.rootDir : ROOT;
  const entry = path.join(root, addon.entry);
  const addonRoot = path.resolve(path.dirname(entry), "..");
  const srcRoot = path.join(addonRoot, "src");
  const sourceFiles = collectFilesRecursive(srcRoot);
  const filesToHash = sourceFiles.length > 0 ? sourceFiles : [entry];

  const hash = crypto.createHash("sha256");
  if (project) {
    hash.update(JSON.stringify({ project: publicProject(project), themeCss: project.themeCss, addon, pipeline: 8 }));
    // Shared source and build tooling affect add-on bytes as well as its own src.
    for (const directory of ['addons/shared', 'build']) for (const file of collectFilesRecursive(path.join(root, directory)).sort()) { hash.update(path.relative(root, file)); hash.update(hashFile(file)); }
    for (const file of ['addons/build-addon.js', 'scripts/projectConfig.cjs', 'scripts/addon-catalog.cjs', 'scripts/normalize-text-assets.cjs']) if (fs.existsSync(path.join(root, file))) hash.update(hashFile(path.join(root, file)));
  }
  hash.update(
    JSON.stringify({
      id: addon.id,
      name: addon.name,
      namespace: project ? addonMetadata(addon, project).namespace : resolveAddonNamespace(addon),
      description: addon.description,
      author: addon.author,
      entry: addon.entry,
      outfile: addon.outfile,
      matches: normalizeArray(addon.matches, []),
      grants: normalizeArray(addon.grants, ["none"]),
      runAt: addon.runAt || "document-idle",
      capabilities: normalizeArray(addon.capabilities, []),
      requiresCore: Boolean(addon.requiresCore),
      pageScopes: normalizeArray(addon.pageScopes, []),
      runtimeMode: addon.runtimeMode || "core-required",
      downloadUrl: addon.downloadUrl || "",
      isRelease: Boolean(isRelease),
      buildToolVersion: 7,
    }),
  );

  filesToHash
    .sort((a, b) => a.localeCompare(b))
    .forEach((filePath) => {
      hash.update(path.relative(root, filePath));
      hash.update(hashFile(filePath));
    });

  return hash.digest("hex");
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing add-ons manifest: ${MANIFEST_PATH}`);
  }

  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const addons = Array.isArray(parsed.addons) ? parsed.addons : [];
  if (addons.length === 0) {
    throw new Error("No add-ons defined in addons.manifest.json");
  }
  const errors = validateManifest(addons);
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return addons;
}

function writeManifest(addons) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  manifest.addons = addons;
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

function updateAddonVersions(addons, bumpType) {
  const updated = addons.map((addon) => {
    const currentVersion = formatVersion(bumpVersion(addon.version, bumpType));
    const changed = currentVersion !== addon.version;
    if (changed) {
      console.log(`📦 ${addon.id}: ${addon.version} -> ${currentVersion} (${bumpType})`);
    }
    return { ...addon, version: currentVersion };
  });
  return updated;
}

function normalizeArray(input, fallback = []) {
  return Array.isArray(input) ? input : fallback;
}

function sanitizeAddonId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resolveAddonNamespace(addon) {
  const fromManifest = String(addon?.namespace || "").trim();
  if (fromManifest) return fromManifest;

  const safeId = sanitizeAddonId(addon?.id || "addon");
  return `${loadProject({ rootDir: ROOT }).metadata.namespace.replace(/\/$/, "")}/addons/${safeId}`;
}

function headerForAddon(addon, { includeTimestamp = true, project = loadProject() } = {}) {
  return projectHeader(addonMetadata(addon, project), addon.version, {
    align: true,
    banner: includeTimestamp ? '// Built on ' + new Date().toISOString() + ' -- AUTO-GENERATED' : '// Deterministic smoke build -- temporary output only',
    buildInfo: addon.requiresCore ? '// Requires ' + project.metadata.name + ' core (' + project.id + ').' : '// Standalone add-on.',
  });
}

async function buildAddon(addon, isRelease, { project = null } = {}) {
  const root = project ? project.rootDir : ROOT;
  const built = await buildAddonToPath(addon, isRelease, { outputPath: path.join(root, addon.outfile), project });
  console.log(addon.id + ' -> ' + path.relative(root, built.outputPath) + ' (' + (built.bytes / 1024).toFixed(2) + ' KB)');
  return { builtCode: built.code, header: built.header, outfile: built.outputPath, addonId: addon.id };
}

async function buildAddonToPath(
  addon,
  isRelease,
  { outputPath, deterministicHeader = false, metafile = false, project = null } = {},
) {
  const root = project ? project.rootDir : ROOT;
  const entry = path.join(root, addon.entry);
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing add-on entry: ${addon.entry}`);
  }
  if (!outputPath) throw new Error("Smoke build requires an output path.");

  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    write: false,
    metafile,
    legalComments: "none",
    loader: {
      ".html": "text",
      ".css": "text",
    },
    minifyWhitespace: Boolean(isRelease),
    minifyIdentifiers: false,
    minifySyntax: Boolean(isRelease),
    plugins: [projectInputs(project), normalizedTextAssets, ...(isRelease ? [createStripDebugLogs()] : [])],
    define: {
      ...(project ? { __APERTURE_DEBUG__: isRelease ? "false" : "true", __APERTURE_PROJECT_ID__: JSON.stringify(project.id) } : {}),
      __ADDON_ID__: JSON.stringify(addon.id),
      __ADDON_NAME__: JSON.stringify(addon.name || addon.id || "Add-on"),
      __ADDON_VERSION__: JSON.stringify(addon.version || "0.1.0"),
      __ADDON_DESCRIPTION__: JSON.stringify(addon.description || ""),
      __ADDON_CAPABILITIES__: JSON.stringify(normalizeArray(addon.capabilities, [])),
      __ADDON_REQUIRES_CORE__: addon.requiresCore ? "true" : "false",
      __ADDON_PAGE_SCOPES__: JSON.stringify(normalizeArray(addon.pageScopes, [])),
      __ADDON_RUNTIME_MODE__: JSON.stringify(addon.runtimeMode || "core-required"),
      __ADDON_MATCHES__: JSON.stringify(normalizeArray(addon.matches, [])),
    },
  });

  const builtCode = result.outputFiles[0].text || result.outputFiles[0].contents.toString("utf8");
  const header = headerForAddon(addon, { includeTimestamp: !deterministicHeader, ...(project ? { project } : {}) });
  const absoluteOutput = path.resolve(root, outputPath);
  fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
  fs.writeFileSync(absoluteOutput, header + builtCode);
  return {
    addonId: addon.id,
    mode: isRelease ? "release" : "regular",
    outputPath: absoluteOutput,
    bytes: fs.statSync(absoluteOutput).size,
    code: builtCode,
    header,
    metafile: result.metafile || null,
  };
}

async function beautifyFromCode(code, header, outPath) {
  if (!terser) {
    fs.writeFileSync(outPath, header + code);
    console.warn("terser not available — wrote add-on artifact without beautify");
    return;
  }

  const reserved = [
    "GM_setValue",
    "GM_getValue",
    "GM_addValueChangeListener",
    "GM_removeValueChangeListener",
    "GM_xmlhttpRequest",
    "GM_registerMenuCommand",
    "GM_unregisterMenuCommand",
    "unsafeWindow",
    "window",
    "document",
  ];

  const terserOpts = {
    compress: false,
    mangle: { reserved, keep_fnames: true },
    format: { beautify: true, comments: false },
  };

  const result = await terser.minify(code, terserOpts);
  if (result.error) throw result.error;

  fs.writeFileSync(outPath, header + result.code);
}

async function refreshAddonBaseline({
  outputPath = path.join(
    ROOT,
    "docs",
    "architecture",
    "addon-baseline.json",
  ),
  baselineTool = null,
} = {}) {
  const tool = baselineTool || require("../scripts/addon-baseline.cjs");
  const report = await tool.createBaseline();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, tool.stableJson(report));
  console.log(
    `Refreshed add-on baseline -> ${path.relative(ROOT, outputPath)}`,
  );
  return report;
}

async function main(args = process.argv.slice(2), { rootDir = ROOT } = {}) {
  const project = loadProject({ rootDir, configFile: configArgument(args) });
  const isRelease = args.includes('--release'), isSmoke = args.includes('--smoke');
  const forceBuild = isSmoke || args.includes('--force');
  const noBump = isSmoke || !args.includes('--bump') || args.includes('--no-bump');
  if (args.includes('--bump') && args.includes('--no-bump')) throw new Error('--bump conflicts with --no-bump');
  if ((args.includes('--major') || args.includes('--minor')) && !args.includes('--bump')) throw new Error('Version selection requires --bump');
  const bumpType = getBumpType(args);
  const configIndex = args.indexOf('--config');
  const requested = args.find((arg, index) => arg && !arg.startsWith('--') && !(configIndex >= 0 && index === configIndex + 1));
  const addons = readProjectManifest(project);
  const targets = !requested || requested === 'all' ? addons : addons.filter(addon => addon.id === requested);
  if (requested && targets.length === 0) throw new Error('Unknown add-on: ' + requested);
  const cache = readBuildCache(project.resolved.cacheFile);
  const modeKey = isRelease ? 'release' : 'regular';
  const changedTargets = targets.map(addon => ({ addon, hash: computeAddonHash(addon, isRelease, project) })).filter(item =>
    forceBuild || !noBump || !fs.existsSync(path.join(project.rootDir, item.addon.outfile)) || cache.addons[item.addon.id]?.[modeKey] !== item.hash || cache.addons[item.addon.id]?.outputMode !== modeKey || cache.addons[item.addon.id]?.outputHash !== hashFile(path.join(project.rootDir, item.addon.outfile)));
  const targetIds = new Set(changedTargets.map(item => item.addon.id));
  const updated = addons.map(addon => targetIds.has(addon.id) && !noBump ? { ...addon, version: formatVersion(bumpVersion(addon.version, bumpType)) } : addon);
  if (updated.some(addon => addon.version.split('.').some(value => !Number.isSafeInteger(+value)))) throw new Error('version: requested bump exceeds the supported range');
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aperture-addon-build-'));
  const entries = [], artifacts = [];
  try {
    for (const item of changedTargets) {
      const addon = updated.find(candidate => candidate.id === item.addon.id);
      const outputPath = path.join(stagingDir, addon.id + '.user.js');
      const built = await buildAddonToPath(addon, isRelease, { outputPath, project, deterministicHeader: isSmoke || args.includes('--deterministic') });
      if (isRelease) await beautifyFromCode(built.code, built.header, built.outputPath);
      const contents = fs.readFileSync(outputPath, 'utf8');
      artifacts.push({ id: addon.id, contents });
      entries.push({ file: path.join(project.rootDir, addon.outfile), contents });
      // Hash the actual version/metadata emitted, so the next build can skip it.
      cache.addons[addon.id] = { ...cache.addons[addon.id], [modeKey]: computeAddonHash(addon, isRelease, project), outputMode: modeKey, outputHash: crypto.createHash('sha256').update(contents).digest('hex') };
    }
    if (!isSmoke) {
      entries.push(...catalogOutputs(updated, project));
      if (!noBump) entries.push({ file: project.resolved.addonsManifest, contents: JSON.stringify({ addons: updated }, null, 2) + '\n' });
      if (changedTargets.length) entries.push({ file: project.resolved.cacheFile, contents: JSON.stringify(cache, null, 2) + '\n' });
      writeOutputs(entries);
    }
    // Product baseline refresh remains an explicit audit, never a generic build side effect.
    console.log('Add-on ' + (isSmoke ? 'smoke ' : '') + 'build complete: ' + changedTargets.length + '/' + targets.length + '.');
    return { projectId: project.id, isSmoke, artifacts };
  } finally { fs.rmSync(stagingDir, { recursive: true, force: true }); }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Add-on build failed:", error);
    process.exit(1);
  });
}

module.exports = {
  buildAddon,
  buildAddonToPath,
  computeAddonHash,
  headerForAddon,
  readManifest,
  refreshAddonBaseline,
  main,
  beautifyFromCode,
};
