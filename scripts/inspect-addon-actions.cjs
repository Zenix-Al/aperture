const path = require('node:path');
const esbuild = require('esbuild');
const { loadProject } = require('./projectConfig.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const ROOT = path.resolve(__dirname, '..');
async function inspect() {
  const project = loadProject({ rootDir: ROOT });
  const built = await esbuild.build({ entryPoints: [path.join(ROOT, 'src/services/addons/coreActions.js')],
    bundle: true, write: false, format: 'cjs', platform: 'node', loader: { '.html': 'text', '.css': 'text' },
    plugins: [projectInputs(project)], define: { __APERTURE_DEBUG__: 'false' }, logLevel: 'silent' });
  const module = { exports: {} };
  Function('module', 'exports', 'require', built.outputFiles[0].text)(module, module.exports, require);
  process.stdout.write(JSON.stringify(module.exports.getRegisteredAddonActionSnapshot()));
}
inspect().catch(error => { console.error(error); process.exitCode = 1; });
