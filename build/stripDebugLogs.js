const fs = require("fs/promises");

function stripStandaloneDebugLogs(text) {
  // Remove standalone debugLog(...) statements, including multiline argument lists.
  // This intentionally targets statement-form logs only to avoid rewriting expressions.
  return text.replace(/^[ \t]*(?:void\s+|await\s+)?debugLog\([\s\S]*?\);\s*$/gm, "");
}

function createStripDebugLogs({ transformSource = (text) => text } = {}) { return {
  name: "strip-debug-logs",
  setup(build) {
    build.onLoad({ filter: /\.js$/ }, async (args) => {
      if (args.path.includes("node_modules")) return;

      const text = await fs.readFile(args.path, "utf8");
      const stripped = stripStandaloneDebugLogs(transformSource(text));

      return {
        contents: stripped,
        loader: "js",
      };
    });
  },
}; }

const stripDebugLogs = createStripDebugLogs();

module.exports = { stripDebugLogs, createStripDebugLogs, stripStandaloneDebugLogs };
