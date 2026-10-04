// Synchronous harness callers wait on this isolated asynchronous esbuild worker.
// It uses exactly the selected project's normal build inputs, not product fixtures.
const path = require('node:path');
const esbuild = require('esbuild');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { projectInputs } = require('../build/projectInputs.cjs');
const { normalizedTextAssets } = require('../scripts/normalize-text-assets.cjs');
const { themeCss, ...request } = JSON.parse(process.argv[2]);
const project = loadProject({ rootDir: path.resolve(__dirname, '..') });
project.routes = { ...project.routes, isReading: { hostEquals: ['example.org'], pathStartsWith: ['/reading/'] }, isShelf: { hostEquals: ['example.org'], pathStartsWith: ['/shelf/'] } };
if (themeCss !== undefined) project.themeCss = themeCss;
esbuild.build({ ...request, bundle: true, format: 'cjs', platform: 'node',
  plugins: [normalizedTextAssets, projectInputs(project)],
  define: { __APERTURE_DEBUG__: 'false', __APERTURE_PROJECT_ID__: JSON.stringify(project.id) }, logLevel: 'silent',
}).catch(error => { console.error(error); process.exitCode = 1; });
