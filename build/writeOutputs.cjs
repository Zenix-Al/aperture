const fs = require("fs");
const path = require("path");

// Build and beautify in a disposable directory first. Commit only prepared bytes;
// roll back files on a write failure. This does not claim crash-atomic multi-file writes.
function writeOutputs(entries) {
  const seen = new Set();
  const snapshots = entries.map(({ file, contents }) => {
    const target = path.resolve(file);
    if (seen.has(target.toLowerCase()))
      throw new Error(`Duplicate output: ${target}`);
    seen.add(target.toLowerCase());
    return {
      file: target,
      contents,
      previous: fs.existsSync(target) ? fs.readFileSync(target) : null,
    };
  });
  const written = [];
  try {
    for (const entry of snapshots) {
      fs.mkdirSync(path.dirname(entry.file), { recursive: true });
      written.push(entry);
      if (entry.contents === null) fs.rmSync(entry.file, { force: true });
      else fs.writeFileSync(entry.file, entry.contents);
    }
  } catch (error) {
    for (const entry of written.reverse()) {
      if (entry.previous === null) fs.rmSync(entry.file, { force: true });
      else fs.writeFileSync(entry.file, entry.previous);
    }
    throw error;
  }
}
module.exports = { writeOutputs };
