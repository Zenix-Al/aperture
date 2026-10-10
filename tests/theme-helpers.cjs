const path = require('node:path');
const esbuild = require('esbuild');
const fs = require('node:fs');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { validateTheme } = require('../scripts/themeContract.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const ROOT = path.resolve(__dirname, '..');
async function bundle(theme = 'default', { addons = true, minify = false, zIndex } = {}) {
 const project = loadProject({rootDir:ROOT});
 project.theme = theme; project.themeCss = validateTheme(fs.readFileSync(path.join(ROOT, 'themes', theme, 'index.css'),'utf8')).css;
 const result = await esbuild.build({stdin:{resolveDir:ROOT,contents:`
 export * as layers from './src/ui/layers.js';
 export * as main from './src/main.js';
 export * as state from './src/config/state.js';
 export * as ui from './src/ui/index.js';
 export * as modal from './src/ui/components/modal.js';
 export * as dialog from './src/ui/components/dialog.js';
 export * as badge from './src/ui/components/addons/badge.js';
 export * as toast from './src/ui/components/toast.js';
 export * as styles from './src/core/styleRegistry.js';
 export * as resources from './src/core/resourceManager.js';
 export * as readiness from './src/services/storageReadiness.js';
 export * as teardown from './src/core/teardown.js';
 ${addons ? "export * as addons from './src/services/addons/uiHost.js';" : ''}
 `},bundle:true,write:false,format:'iife',globalName:'__theme',minify,metafile:true,
 loader:{'.css':'text','.html':'text'},define:{__APERTURE_DEBUG__:'false',__APERTURE_PROJECT_ID__:JSON.stringify(project.id)},
 plugins:[{name:'phase-four-addon-command-fixture',setup(build){build.onLoad({filter:/projects[\\/]example[\\/]ui\.js$/},()=>({contents:fs.readFileSync(path.join(ROOT,'tests/fixtures/themeOnlyUi.js'),'utf8').replace('export default {', 'export default {' + (zIndex === undefined ? '' : 'zIndex: '+JSON.stringify(zIndex)+',')),loader:'js',resolveDir:path.join(ROOT,'projects/example')}));build.onLoad({filter:/projects[\\/]example[\\/]application\.js$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace(/  extensions: __APERTURE_ADDONS__ \? \{[\s\S]*?\n  \} : \{\},\n/,''),loader:'js',resolveDir:path.dirname(args.path)}));
 }},projectInputs(project)],logLevel:'silent'});
 return {code:result.outputFiles[0].text,metafile:result.metafile,project};
}
module.exports = { ROOT, bundle };
