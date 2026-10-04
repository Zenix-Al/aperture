const esbuild = require("esbuild");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { stripCssComments } = require("./build/stripCssComments");
const { createStripDebugLogs } = require("./build/stripDebugLogs");
const { compactCoreModalHtmlAsset } = require("./build/compactCoreModalHtml");
const { loadProject, configArgument, header: projectHeader } = require("./scripts/projectConfig.cjs");
const { manifestState, projectInputs } = require("./build/projectInputs.cjs");
const { writeOutputs } = require("./build/writeOutputs.cjs");
let terser = null;
try {
  terser = require("terser");
} catch (err) {
  terser = null;
}

function getBumpType(args) {
  if (args.includes("--major")) return "major";
  if (args.includes("--minor")) return "minor";
  return "patch";
}

function bumpVersion(currentVersion, bumpType) {
  if (bumpType === "major") {
    return { major: currentVersion.major + 1, minor: 0, patch: 0 };
  }
  if (bumpType === "minor") {
    return { major: currentVersion.major, minor: currentVersion.minor + 1, patch: 0 };
  }
  return { ...currentVersion, patch: currentVersion.patch + 1 };
}

function resolveBuildVersion(currentVersion, args = []) {
  const isSmoke = args.includes("--smoke");
  const noBump = isSmoke || args.includes("--no-bump");
  const bumpType = getBumpType(args);
  return {
    bumpType,
    isSmoke,
    noBump,
    version: noBump
      ? { ...currentVersion }
      : bumpVersion(currentVersion, bumpType),
  };
}

function getPlugins(isRelease, project) {
  return isRelease
    ? [projectInputs(project), compactCoreModalHtmlAsset, stripCssComments, createStripDebugLogs()]
    : [projectInputs(project), compactCoreModalHtmlAsset, stripCssComments];
}

function getBuildDefines(isRelease, project = null) {
  return { __APERTURE_DEBUG__: isRelease ? "false" : "true", __APERTURE_PROJECT_ID__: JSON.stringify(project?.id || "aperture") };
}

function getBuildInfo(target, isRelease) {
  const mode = isRelease ? "release" : "regular";
  let artifact = target.isUglified ? "fully uglified" : "readable";
  if (isRelease && !target.isUglified) artifact = "bit-uglified (names preserved)";

  const logStatus = isRelease ? "debugLog call sites stripped" : "debugLog call sites retained";

  return [`// Build mode: ${mode}`, `// Artifact: ${artifact}`, `// Logs: ${logStatus}`].join("\n");
}

function renderHeader(metadata, { name, version, banner, buildInfo }) {
  return projectHeader(metadata, version, { name, banner, buildInfo });
}

async function beautifyFromCode(code, header, outPath) {
  if (!terser) {
    // fallback: write as-is
    fs.writeFileSync(outPath, header + code);
    console.warn("terser not available — wrote readable artifact without beautify");
    return;
  }

  const reserved = [
    "GM_setValue",
    "GM_getValue",
    "GM_xmlhttpRequest",
    "GM_registerMenuCommand",
    "GM_unregisterMenuCommand",
    "unsafeWindow",
    "window",
    "document",
  ];

  const terserOpts = {
    // Keep readable artifact semantics identical to esbuild output.
    // Debug log stripping already happens via build plugins in release mode.
    compress: false,
    // Allow local identifier mangling while preserving common globals.
    mangle: { reserved, keep_fnames: true },
    // Keep output readable for reviewers.
    format: { beautify: true, comments: false },
  };

  const result = await terser.minify(code, terserOpts);
  if (result.error) throw result.error;
  fs.writeFileSync(outPath, header + result.code);
  console.log(`Beautified readable output: ${outPath}`);
}

async function buildTarget(target, baseOptions, headerTemplate, version, banner, isRelease) {
  const result = await esbuild.build({
    ...baseOptions,
    minifyWhitespace: target.minifyWhitespace,
    minifyIdentifiers: target.minifyIdentifiers,
    minifySyntax: target.minifySyntax,
    write: false, // in-memory for speed
  });

  const out = result.outputFiles[0];
  const builtCode = out.text || out.contents.toString("utf8");

  const buildInfo = getBuildInfo(target, isRelease);
  const header = renderHeader(headerTemplate, {
    name: target.scriptName,
    version,
    banner,
    buildInfo,
  });

  fs.mkdirSync(path.dirname(target.finalOutfile), { recursive: true });
  fs.writeFileSync(target.finalOutfile, header + builtCode);

  console.log(`✅ ${target.label} complete → ${target.finalOutfile}`);
  return builtCode;
}

async function main(args = process.argv.slice(2), { rootDir = __dirname } = {}) {
  const project = loadProject({ rootDir, configFile: configArgument(args) });
  const isRelease = args.includes('--release');
  if (args.includes('--bump') && args.includes('--no-bump')) throw new Error('--bump conflicts with --no-bump');
  if ((args.includes('--major') || args.includes('--minor')) && !args.includes('--bump')) throw new Error('Version selection requires --bump');
  const { isSmoke, noBump, version: nextVersion } = resolveBuildVersion(project.version, args.includes('--bump') ? args : [...args, '--no-bump']);
  if (Object.values(nextVersion).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('version: requested bump exceeds the supported range');
  const versionString = [nextVersion.major, nextVersion.minor, nextVersion.patch].join('.');
  const manifest = manifestState(project);
  // Validate the selected add-on contract before any build output/version writes.
  require('./scripts/addon-catalog.cjs').readProjectManifest(project);
  const banner = isSmoke || args.includes('--deterministic')
    ? '// Deterministic build -- AUTO-GENERATED'
    : '// Built on ' + new Date().toISOString() + ' -- AUTO-GENERATED';
  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aperture-build-'));
  const baseBuildOptions = {
    absWorkingDir: project.rootDir,
    entryPoints: [project.resolved.entry], bundle: true, format: 'iife', legalComments: 'none',
    loader: { '.html': 'text', '.css': 'text' },
    define: getBuildDefines(isRelease, project), plugins: getPlugins(isRelease, project),
  };
  const targets = [
    { label: isRelease ? 'Bit-Uglified Readable' : 'Regular', scriptName: project.metadata.name,
      isUglified: false, minifyWhitespace: isRelease, minifyIdentifiers: false, minifySyntax: isRelease,
      filename: project.build.outputName + '.user.js' },
    { label: 'Fully Uglified', scriptName: project.metadata.name + ' (Uglified)',
      isUglified: true, minifyWhitespace: true, minifyIdentifiers: true, minifySyntax: true,
      filename: project.build.outputName + '.uglified.user.js' },
  ].map(target => ({ ...target, finalOutfile: path.join(stagingDir, target.filename) }));
  try {
    // Wait for both targets, including failures, before disposing staging files.
    const results = await Promise.allSettled(targets.map(target => buildTarget(target, baseBuildOptions, project.metadata, versionString, banner, isRelease)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (isRelease) {
      const readableIndex = targets.findIndex(target => !target.isUglified);
      const target = targets[readableIndex];
      const header = renderHeader(project.metadata, { name: target.scriptName, version: versionString, banner, buildInfo: getBuildInfo(target, true) });
      await beautifyFromCode(results[readableIndex].value, header, target.finalOutfile);
    }
    const artifacts = targets.map(target => ({ filename: target.filename, contents: fs.readFileSync(target.finalOutfile, 'utf8') }));
    if (!isSmoke) {
      const entries = artifacts.map(artifact => ({ file: path.join(project.resolved.outputDir, artifact.filename), contents: artifact.contents }));
      entries.push({ file: project.resolved.featureManifest, contents: manifest.contents });
      if (!noBump) entries.push({ file: project.resolved.versionFile, contents: JSON.stringify(nextVersion, null, 2) + '\n' });
      writeOutputs(entries);
    }
    console.log(isSmoke ? 'Smoke build completed without changing project outputs.' : 'Project build complete: ' + versionString);
    return { projectId: project.id, version: versionString, isSmoke, artifacts, featureNames: manifest.featureNames };
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
  });
}

module.exports = {
  bumpVersion,
  getBumpType,
  resolveBuildVersion,
  main,
  getBuildDefines,
  getPlugins,
};
