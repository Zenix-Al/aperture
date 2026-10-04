const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkMarkdownLinks } = require('../scripts/check-docs.cjs');
function fixture(markdown, verify) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aperture-doc-links-'));
  try {
    fs.writeFileSync(path.join(directory, 'index.md'), markdown);
    fs.writeFileSync(path.join(directory, 'target.md'), '# Valid anchor\n');
    fs.mkdirSync(path.join(directory, '.artifacts'));
    fs.writeFileSync(path.join(directory, '.artifacts', 'old-guide.md'), '[Archived scratch](missing.md)\n');
    verify(checkMarkdownLinks({ rootDir: directory }));
  } finally {
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
test('Docs audit ignores fenced/inline code while validating real links on the same line', () => {
  fixture('````js\n[not a link](missing-source)\n```\n[still code](missing-inner)\n````\n~~~text\n[code](missing-tilde)\n~~~\n`[call](threadId)` [valid](target.md#valid-anchor) [broken](missing.md)\n', errors => {
    assert.equal(errors.length, 1);
    assert.match(errors[0], /index.md:9: missing local Markdown target 'missing.md'/);
  });
});
test('Docs audit retains missing-target and invalid-anchor failures', () => {
  fixture('[missing](missing.md)\n[bad anchor](target.md#absent)\n[valid](target.md#valid-anchor)\n', errors => {
    assert.equal(errors.length, 2);
    assert.match(errors[0], /missing local Markdown target/);
    assert.match(errors[1], /missing anchor '#absent'/);
  });
});
test('Build-selected theme and display-name changes retain original persistence identity', async () => {
  const esbuild = require('esbuild');
  const vm = require('node:vm');
  const { loadProject } = require('../scripts/projectConfig.cjs');
  const { projectInputs } = require('../build/projectInputs.cjs');
  const { validateTheme } = require('../scripts/themeContract.cjs');
  async function keys(theme, displayName) {
    const project = loadProject({ configFile: 'projects/reading-desk/config.json' });
    project.theme = theme;
    project.themeCss = validateTheme(fs.readFileSync(path.join(project.rootDir, 'themes', theme, 'index.css'), 'utf8')).css;
    project.metadata.name = displayName;
    const built = await esbuild.build({ stdin: { resolveDir: project.rootDir, contents: "export * from './src/config/persistence.js'; export {default as selectedTheme} from 'aperture:theme';" }, bundle: true, write: false, format: 'cjs', loader: { '.css': 'text', '.html': 'text' }, plugins: [projectInputs(project)] });
    const context = { module: { exports: {} }, exports: {} }; vm.runInNewContext(built.outputFiles[0].text, context);
    const api = context.module.exports;
    return { keys: JSON.parse(JSON.stringify(api.CONFIG_STORAGE_KEYS)), addon: api.getAddonStorageKey('example-addon', 'bookmark'), database: api.getAddonDatabaseName('example-addon', 'notes'), theme: api.selectedTheme };
  }
  const original = await keys('default', 'Reading Desk');
  const cosmetic = await keys('light', 'Renamed Reading Desk');
  assert.notEqual(original.theme, cosmetic.theme);
  assert.deepEqual(cosmetic.keys, original.keys);
  assert.equal(cosmetic.addon, original.addon);
  assert.equal(cosmetic.database, original.database);
});


test('source size audits ignore checkout line endings but detect real growth', async () => {
  const { auditCoreSource } = require('../scripts/core-source-audit.cjs');
  const { auditCss } = require('../scripts/css-audit.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aperture-audit-newlines-'));
  try {
    fs.mkdirSync(path.join(directory, 'src/core'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'src/ui/assets'), { recursive: true });
    const sources = {
      'src/core/sample.js': 'export const sample = 1;\nexport function run() { return sample; }\n',
      'src/ui/assets/startup.css': '.launcher {\n  opacity: 0.75;\n}\n',
      'src/ui/assets/css.css': '.panel {\n  padding: 10px;\n}\n',
    };
    const write = transform => { for (const [file, source] of Object.entries(sources)) fs.writeFileSync(path.join(directory, file), transform(source)); };
    write(source => source);
    const core = auditCoreSource(directory);
    const css = await auditCss({ rootDir: directory, includeBundle: false });
    write(source => source.replace(/\n/g, '\r\n'));
    assert.deepEqual(auditCoreSource(directory), core);
    assert.deepEqual(await auditCss({ rootDir: directory, includeBundle: false }), css);
    fs.appendFileSync(path.join(directory, 'src/core/sample.js'), 'export const added = 2;\n');
    assert(auditCoreSource(directory).authoredBytes > core.authoredBytes);
  } finally {
    assert(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
