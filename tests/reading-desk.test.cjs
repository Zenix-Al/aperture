const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, CONFIG, buildDemo } = require('../scripts/reading-desk.cjs');
const { loadProject } = require('../scripts/projectConfig.cjs');
const { checkProjectFeatureManifest } = require('../scripts/featureManifest.cjs');

test('Reading Desk uses original entry, selected manifest and narrow local metadata', () => {
  const project = loadProject({ configFile: CONFIG });
  assert.equal(project.build.entry, 'src/main.js');
  assert.equal(project.id, 'reading-desk');
  assert.deepEqual(Object.keys(project.routes), ['isReading', 'isShelf']);
  assert.deepEqual(project.metadata.matches, ['http://localhost:4173/reading/*', 'http://localhost:4173/shelf/*']);
  assert.equal(checkProjectFeatureManifest({ configFile: CONFIG }).matches, true);
});
test('Real regular/release smoke artifacts have exact metadata and no product imports, without version/output writes', async () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'version.json')), false);
  const protectedFiles = ['projects/example/version.json', 'projects/reading-desk/version.json', 'projects/reading-desk/addons.manifest.json', 'projects/reading-desk/generated/features.generated.js'];
  const before = protectedFiles.map(file => fs.readFileSync(path.join(ROOT, file)));
  const outputDir = path.join(ROOT, 'projects/reading-desk/dist');
  const snapshotOutput = () => fs.existsSync(outputDir) ? fs.readdirSync(outputDir, { recursive: true }).sort().filter(file => fs.statSync(path.join(outputDir, file)).isFile()).map(file => [file, fs.readFileSync(path.join(outputDir, file)).toString('base64')]) : null;
  const outputBefore = snapshotOutput();
  for (const release of [false, true]) {
    const demo = await buildDemo({ release });
    assert.equal(fs.existsSync(path.join(ROOT, 'version.json')), false);
    assert.equal(demo.core.isSmoke, true);
    assert.equal(demo.core.artifacts.length, 2);
    for (const artifact of [...demo.core.artifacts.map(row => row.contents), demo.addon.code]) {
      assert(artifact.includes('@version      0.1.0') || /@version\s+0\.1\.0/.test(artifact));
      assert.match(artifact, /@match\s+http:\/\/localhost:4173\/reading\/\*/);
      assert(!/cdn\.jsdelivr|latest\.min\.js/i.test(artifact));
      assert(!/@(?:updateURL|downloadURL|connect|require)\s/.test(artifact));
    }
    assert.match(demo.core.artifacts[0].contents, /@name\s+Reading Desk/);
    assert.match(demo.core.artifacts[0].contents, /@run-at\s+document-start/);
    assert.match(demo.addon.code, /@name\s+Reading Desk Bookmark/);
    assert.match(demo.addon.code, /@grant\s+none/);
    assert(!/@match\s+.*\/shelf\//.test(demo.addon.code));
    assert(!Object.keys(demo.addon.metafile.inputs).some(file => /latestMarkers|library-addon/.test(file)));
  }
  protectedFiles.forEach((file, index) => assert.deepEqual(fs.readFileSync(path.join(ROOT, file)), before[index]));
  assert.deepEqual(snapshotOutput(), outputBefore);
});
