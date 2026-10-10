const path = require("path");
const fs = require("fs");
const { compactCoreModalHtml } = require("./compactCoreModalHtml.js");
const { stripCssText } = require("./stripCssComments.js");
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
      const enabled = project.addons !== false;
      build.initialOptions.define = { ...build.initialOptions.define, __APERTURE_ADDONS__: String(enabled) };
      for (const [name, enabledSource, disabledSource] of [
        ["addon-schema", 'export * from "./src/config/addonSchema.js";', 'export const addonConfigSchema = undefined; export const defaultAddonsApiThrottleSettings = undefined;'],
        ["addon-service", 'export * from "./src/services/addonsService.js";', 'export const initAddonsConsoleBridge = undefined, refreshAddonSecurityPolicies = undefined, shutdownAddonsService = undefined, listKnownAddons = undefined;'],
        ["addon-settings", 'export { addonsServiceSettingsMeta, addonsServiceSettingsDialogMeta } from "./src/services/addons/settingsUi.js";', 'export const addonsServiceSettingsMeta = undefined, addonsServiceSettingsDialogMeta = undefined;'],
      ]) {
        build.onResolve({ filter: new RegExp("^aperture:" + name + "$") }, () => ({ path: name, namespace: "aperture-optional-platform" }));
        build.onLoad({ filter: new RegExp("^" + name + "$"), namespace: "aperture-optional-platform" }, () => ({ contents: enabled ? enabledSource : disabledSource, loader: "js", resolveDir: project.rootDir }));
      }
      if (!enabled) {
        // Prune unreachable optional blocks in readable builds as well as release builds.
        build.initialOptions.minifySyntax = true;
        build.onResolve({ filter: /^aperture:(?:addons|addon-input|addon-extensions)$/ }, args => ({ errors: [{ text: `Add-on input '${args.path}' is unavailable with addons:false.` }] }));
        build.onResolve({ filter: /(?:addonsService(?:\.js)?$|(?:^|\/)addons\/|(?:^|\/)addonSchema\.js$|addonsRenderer\.js$)/ }, args => ({ errors: [{ text: `Add-on platform is excluded by addons:false; remove the direct import '${args.path}' or use the optional Aperture build inputs.` }] }));
        build.onLoad({ filter: /[\\/]src[\\/]ui[\\/]assets[\\/](?:ui\.html|css\.css|startup\.css)$/ }, args => {
          const source = fs.readFileSync(args.path, "utf8");
          const filtered = source.replace(/<!-- aperture:addons:start -->[\s\S]*?<!-- aperture:addons:end -->/g, "")
            .replace(/\/\* aperture:addons:start \*\/[\s\S]*?\/\* aperture:addons:end \*\//g, "")
            .replace(/:not\(#settings-panel-addins\)/g, "");
          return { contents: args.path.endsWith(".html") ? compactCoreModalHtml(filtered) : stripCssText(filtered), loader: "text" };
        });
      }
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
      build.onLoad({ filter: /.*/, namespace: 'aperture-ui-policy' }, () => ({ contents: enabled ? 'import ui from "aperture:ui"; import * as controller from "./src/ui/components/addons/settingsController.js"; import * as renderer from "./src/ui/renderers/addonsRenderer.js"; export default { ...controller, ...renderer, ...ui.hooks };' : 'import ui from "aperture:ui"; export default { ...ui.hooks };', loader: 'js', resolveDir: project.rootDir }));
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
        contents: `export default ${JSON.stringify(args.path === "aperture:theme" ? (enabled ? project.themeCss : project.themeCss.replace(/--aperture-addon-[a-z-]+\s*:[^;]+;/g, "")) : publicProject(project))};`,
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
