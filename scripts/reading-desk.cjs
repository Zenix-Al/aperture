const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { main: buildCore } = require('../build.js');
const { loadProject } = require('./projectConfig.cjs');
const { buildAddonToPath } = require('../addons/build-addon.js');
const ROOT = path.resolve(__dirname, '..');
const CONFIG = 'projects/reading-desk/config.json';
async function buildDemo({ theme = 'default', release = false } = {}) {
  // Alternate selection is a temporary config, never a runtime theme picker.
  const name = 'projects/reading-desk/.smoke-' + randomUUID() + '.json';
  const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG), 'utf8'));
  projectConfig.theme = theme;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aperture-reading-'));
  fs.writeFileSync(path.join(ROOT, name), JSON.stringify(projectConfig));
  try {
    const project = loadProject({ rootDir: ROOT, configFile: name });
    const core = await buildCore(['--config', name, '--smoke', ...(release ? ['--release'] : [])]);
    const addon = JSON.parse(fs.readFileSync(project.resolved.addonsManifest, 'utf8')).addons[0];
    const built = await buildAddonToPath(addon, release, { project, outputPath: path.join(temporary, 'bookmark.user.js'), deterministicHeader: true, metafile: true });
    return { project, core, addon: { ...built, code: fs.readFileSync(path.join(temporary, 'bookmark.user.js'), 'utf8') }, descriptor: addon, site: fs.readFileSync(path.join(ROOT, 'projects/reading-desk/site/index.html'), 'utf8') };
  } finally {
    fs.rmSync(path.join(ROOT, name), { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
function serveDemo(demo, port = 4173) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let body, type;
    if (url.pathname === '/scripts/core.user.js') { body = demo.core.artifacts.find(row => !row.filename.includes('uglified')).contents; type = 'application/javascript'; }
    else if (url.pathname === '/scripts/bookmark.user.js') { body = demo.addon.code; type = 'application/javascript'; }
    else if (['/reading/', '/shelf/'].some(prefix => url.pathname.startsWith(prefix))) { body = demo.site; type = 'text/html'; }
    else { response.writeHead(404); response.end('Use /reading/one or /shelf/.'); return; }
    response.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(body);
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, 'localhost', () => resolve(server)); });
}
if (require.main === module) {
  buildDemo({ theme: process.argv.includes('--light') ? 'light' : 'default' }).then(demo => serveDemo(demo)).then(server => {
    console.log('Reading Desk: http://localhost:4173/reading/one (Ctrl+C to stop). Builds are temporary and do not bump versions.');
    console.log('After source changes, install/reinstall http://localhost:4173/scripts/core.user.js in your userscript manager and reload the page. Restarting this server does not update installed scripts.');
    process.once('SIGINT', () => server.close());
    process.once('SIGTERM', () => server.close());
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { ROOT, CONFIG, buildDemo, serveDemo };
