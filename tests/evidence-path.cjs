const fs = require('node:fs');
const path = require('node:path');

// Reports/screenshots are disposable evidence, separate from tests/.tmp bundles.
function evidencePath(relativePath) {
  const output = path.join(__dirname, '..', '.artifacts', 'browser', relativePath);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  return output;
}

module.exports = { evidencePath };
