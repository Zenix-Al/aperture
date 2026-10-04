#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const SKIPPED_DIRECTORIES = new Set([".artifacts", ".git", "dist", "node_modules", "coverage", "build", "out"]);
const EXTERNAL_PROTOCOL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function toPosix(value) {
  return String(value || "").replace(/\\/g, "/");
}

function walkMarkdown(rootDir, directory = rootDir, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walkMarkdown(rootDir, path.join(directory, entry.name), files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files.sort();
}

function slugifyHeading(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-");
}

function getAnchors(filePath) {
  const anchors = new Set();
  const source = fs.readFileSync(filePath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match) anchors.add(slugifyHeading(match[1]));
  }
  return anchors;
}

function parseLinkTarget(rawTarget) {
  let target = String(rawTarget || "").trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  const separator = target.search(/\s+["']/);
  if (separator >= 0) target = target.slice(0, separator);
  const hashIndex = target.indexOf("#");
  return {
    filePath: hashIndex >= 0 ? target.slice(0, hashIndex) : target,
    anchor: hashIndex >= 0 ? target.slice(hashIndex + 1) : "",
  };
}

function checkMarkdownLinks({ rootDir = process.cwd() } = {}) {
  const errors = [];
  for (const markdownFile of walkMarkdown(rootDir)) {
    const lines = fs.readFileSync(markdownFile, "utf8").split(/\r?\n/);
    let fence = null;
    lines.forEach((line, index) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        return;
      }
      if (marker) { fence = { char: marker[1][0], length: marker[1].length }; return; }
      // Source snippets are evidence, not Markdown links. Keep real links on
      // the same line, and leave original line numbers intact in diagnostics.
      const prose = line.replace(/(`+)(.*?)\1(?!`)/g, match => " ".repeat(match.length));
      const linkPattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
      let match;
      while ((match = linkPattern.exec(prose))) {
        const { filePath, anchor } = parseLinkTarget(match[1]);
        if (!filePath && !anchor) continue;
        if (EXTERNAL_PROTOCOL.test(filePath)) continue;
        const targetFile = filePath
          ? path.resolve(path.dirname(markdownFile), decodeURIComponent(filePath))
          : markdownFile;
        const location = `${toPosix(path.relative(rootDir, markdownFile))}:${index + 1}`;
        if (!fs.existsSync(targetFile)) {
          errors.push(`${location}: missing local Markdown target '${filePath}'.`);
          continue;
        }
        if (anchor && !getAnchors(targetFile).has(decodeURIComponent(anchor).toLowerCase())) {
          errors.push(`${location}: missing anchor '#${anchor}' in '${toPosix(path.relative(rootDir, targetFile))}'.`);
        }
      }
    });
  }
  return errors;
}

function main() {
  const errors = checkMarkdownLinks();
  if (errors.length) {
    console.error("Documentation checks failed:");
    errors.forEach((error) => console.error(`  ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log("Documentation checks passed.");
}

if (require.main === module) main();

module.exports = { checkMarkdownLinks, getAnchors, slugifyHeading };
