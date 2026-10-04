const path = require("path");
const { checkFeatureManifest, checkProjectFeatureManifest } = require("./featureManifest.cjs");
const { configArgument } = require('./projectConfig.cjs');

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const rootDir = path.resolve(readOption("--root", process.cwd()));
const outputFile = readOption("--output", "src/generated/features.generated.js");
// Explicit --root/--output retain the original source-fixture inspection API.
let result;
try {
  result = process.argv.includes('--root') || process.argv.includes('--output')
    ? checkFeatureManifest({ rootDir, outputFile })
    : checkProjectFeatureManifest({ rootDir, configFile: configArgument(process.argv.slice(2)) });
} catch (error) { console.error(error.message); process.exit(1); }

if (!result.matches) {
  if (result.errors.length) console.error(result.errors.join("\n"));
  else console.error(`Generated manifest is stale: ${result.outputFile}`);
  console.error("Refresh the selected project with generateProjectFeatureManifest; explicit source fixtures use generateFeatureManifest.");
  process.exitCode = 1;
} else {
  console.log("Generated manifest is up to date.");
}
