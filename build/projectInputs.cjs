const path = require("path");
const { readProjectManifest, buildTrustedCatalog, isNarrowerMatch } = require("../scripts/addon-catalog.cjs");
const { buildFeatureManifestState } = require("../scripts/featureManifest.cjs");
const { repositoryPath } = require("../scripts/projectConfig.cjs");

function manifestState(project, outputFile = project.build.featureManifest) {
  const state = buildFeatureManifestState({
    rootDir: project.rootDir,
    featuresDir: project.build.featuresDir,
    outputFile,
  });
  if (state.errors.length) throw new Error(state.errors.join("\n"));
  for (const entry of state.entries)
    repositoryPath(
      project.rootDir,
      entry.relativePath ||
        path.relative(project.rootDir, entry.filePath).replace(/\\/g, "/"),
      "features.entry",
      { exists: true },
    );
  return state;
}
function publicProject(project) {
  return Object.fromEntries(
    [
      "schemaVersion",
      "id",
      "storageNamespace",
      "metadata",
      "routes",
      "theme",
    ].map((key) => [key, project[key]]),
  );
}
function projectInputs(project) {
  const originalManifest = path.join(
    project.rootDir,
    "src/generated/features.generated.js",
  );
  return {
    name: "aperture-project-inputs",
    setup(build) {
      build.onResolve({ filter: /^aperture:framework$/ }, () => ({ path: "framework", namespace: "aperture-framework" }));
      build.onLoad({ filter: /.*/, namespace: "aperture-framework" }, () => ({
        contents: `export default Object.freeze(${JSON.stringify({ name: "Aperture", version: require("../package.json").version })});`,
        loader: "js",
      }));
      build.onResolve({ filter: /^aperture:addon-input$/ }, () => project.resolved.addons ? { path: project.resolved.addons } : { path: "addon-input", namespace: "aperture-empty-addon-input" });
      build.onLoad({ filter: /.*/, namespace: "aperture-empty-addon-input" }, () => ({ contents: "export default {};", loader: "js" }));
      build.onResolve({ filter: /^aperture:addon-extensions$/ }, () => ({ path: "addon-extensions", namespace: "aperture-addon-extensions" }));
      build.onLoad({ filter: /.*/, namespace: "aperture-addon-extensions" }, () => ({ contents: 'import input from "aperture:addon-input"; export default input.extensions || {};', loader: "js" }));
      build.onResolve({ filter: /^aperture:addons$/ }, () => ({ path: 'addons', namespace: 'aperture-addons' }));
      build.onLoad({ filter: /.*/, namespace: 'aperture-addons' }, () => ({
        contents: `import input from "aperture:addon-input"; export default { ...${JSON.stringify({
          scopes: Object.keys(project.routes).map(key => [key.slice(2).toLowerCase(), key]),
          coreMatches: [...new Set([...project.metadata.matches, ...readProjectManifest(project).flatMap(addon => addon.matches.filter(pattern => project.metadata.matches.some(parent => isNarrowerMatch(pattern, parent))))])],
          catalog: buildTrustedCatalog(readProjectManifest(project)),
        })}, ...input, ...${JSON.stringify({ catalogMetaUrl: project.addonUpdates?.catalogURL || "", catalogBaseUrl: project.addonUpdates?.catalogURL ? new URL(".", project.addonUpdates.catalogURL).href : "" })} };`, loader: 'js',
      }));
      build.onResolve({ filter: /^aperture:ui$/ }, () => project.resolved.ui ? { path: project.resolved.ui } : { path: 'ui', namespace: 'aperture-empty-ui' });
      build.onLoad({ filter: /.*/, namespace: 'aperture-empty-ui' }, () => ({ contents: 'export default {};', loader: 'js' }));
      build.onResolve({ filter: /^aperture:ui-policy$/ }, () => ({ path: 'ui-policy', namespace: 'aperture-ui-policy' }));
      build.onLoad({ filter: /.*/, namespace: 'aperture-ui-policy' }, () => ({ contents: 'import ui from "aperture:ui"; import * as controller from "./src/ui/components/addons/settingsController.js"; import * as renderer from "./src/ui/renderers/addonsRenderer.js"; export default { ...controller, ...renderer, ...ui.hooks };', loader: 'js', resolveDir: project.rootDir }));
      build.onResolve({ filter: /^aperture:effects$/ }, () => ({ path: 'effects', namespace: 'aperture-effects' }));
    build.onLoad({ filter: /.*/, namespace: 'aperture-effects' }, () => ({ contents: 'import settings from "aperture:settings"; export default settings.effects || {};', loader: 'js' }));
    build.onResolve({ filter: /^aperture:settings$/ }, () =>
        project.resolved.settings
          ? { path: project.resolved.settings }
          : { path: "settings", namespace: "aperture-empty-settings" });
      build.onLoad({ filter: /.*/, namespace: "aperture-empty-settings" }, () => ({ contents: "export default { schema: {} };", loader: "js" }));
      build.onResolve({ filter: /^aperture:application$/ }, () =>
        project.resolved.application
          ? { path: project.resolved.application }
          : { path: "application", namespace: "aperture-empty-application" });
      build.onLoad({ filter: /.*/, namespace: "aperture-empty-application" }, () => ({ contents: "export default {};", loader: "js" }));
      build.onResolve({ filter: /^aperture:(project|theme)$/ }, (args) => ({
        path: args.path,
        namespace: "aperture-input",
      }));
      build.onLoad({ filter: /.*/, namespace: "aperture-input" }, (args) => ({
        contents: `export default ${JSON.stringify(args.path === "aperture:theme" ? project.themeCss : publicProject(project))};`,
        loader: "js",
      }));
      build.onLoad({ filter: /features\.generated\.js$/ }, (args) => {
        if (
          path.resolve(args.path) !== originalManifest &&
          path.resolve(args.path) !== project.resolved.featureManifest
        )
          return;
        const state = manifestState(
          project,
          path.relative(project.rootDir, args.path).replace(/\\/g, "/"),
        );
        return {
          contents: state.contents,
          loader: "js",
          resolveDir: path.dirname(args.path),
        };
      });
    },
  };
}
module.exports = {
  manifestState,
  publicProject,
  projectInputs,
};
