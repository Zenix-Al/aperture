const path = require('node:path');
const esbuild = require('esbuild');
const builder = require('../build.js');
const { loadProject } = require('../scripts/projectConfig.cjs');
const ROOT = path.resolve(__dirname, '..');
const CONFIG = 'projects/example/core-only.json';
async function bundle({ enabled = false, release = false } = {}) {
  const project = loadProject({ rootDir: ROOT, configFile: enabled ? 'config.json' : CONFIG });
  const result = await esbuild.build({ absWorkingDir: ROOT, entryPoints: [project.resolved.entry],
    bundle: true, write: false, format: 'iife', metafile: true, legalComments: 'none',
    loader: { '.html': 'text', '.css': 'text' }, minifySyntax: release,
    define: builder.getBuildDefines(release, project), plugins: builder.getPlugins(release, project),
    logLevel: 'silent' });
  return { project, code: result.outputFiles[0].text, inputs: Object.keys(result.metafile.inputs).map(file => file.replaceAll('\\', '/')) };
}
module.exports = { ROOT, CONFIG, bundle };
