const REQUIRED_TOKENS = Object.freeze(["accent", "accent-hover", "accent-active", "focus", "text-primary", "text", "text-secondary", "text-muted", "on-accent", "modal", "sidebar", "card", "control", "raised", "row", "border-strong", "border-control", "border-subtle", "divider", "backdrop", "shadow", "scrollbar-track", "scrollbar-thumb", "chip", "success", "warning", "error", "disabled", "success-surface", "warning-surface", "error-surface", "accent-subtle", "accent-border"]);
const OPTIONAL_TOKENS = Object.freeze(["dock-accent", "dock-accent-hover", "dock-accent-active", "dock-border", "addon-running", "addon-pinned"]);
function validateTheme(css, label = "theme") {
  const fail = message => { throw new Error(`${label}: ${message}`); };
  if (typeof css !== "string" || Buffer.byteLength(css) > 16384) fail("invalid theme size");
  if (!/^\s*\/\* aperture-theme:1 \*\//.test(css)) fail("requires aperture-theme:1 contract");
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const match = /^:root\s*\{([^{}]*)\}\s*$/.exec(body);
  if (!match) fail("only a :root token declaration block is allowed");
  const tokens = {};
  for (const entry of match[1].split(";").filter(value => value.trim())) {
    const part = /^\s*--aperture-([a-z-]+)\s*:\s*(.*?)\s*$/.exec(entry);
    if (!part || ![...REQUIRED_TOKENS, ...OPTIONAL_TOKENS].includes(part[1])) fail("unknown theme token");
    if (Object.hasOwn(tokens, part[1])) fail("duplicate theme token");
    const value = part[2];
    const color = /^(?:#[0-9a-fA-F]{6}|rgba\(\s*(?:\d{1,3}\s*,\s*){3}(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\))$/.test(value);
    const shadow = part[1] === "shadow" && /^0 \d{1,2}px \d{1,2}px rgba\(\s*(?:\d{1,3}\s*,\s*){3}(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/.test(value);
    if (part[1] === "shadow" ? !shadow : !color) fail(`invalid value for ${part[1]}`);
    const channels = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    if (channels && channels.slice(1).some(channel => Number(channel) > 255)) fail("invalid color channel");
    tokens[part[1]] = value;
  }
  for (const token of REQUIRED_TOKENS) if (!Object.hasOwn(tokens, token)) fail(`missing ${token}`);
  for (const [token, fallback] of Object.entries({ "dock-accent": "accent", "dock-accent-hover": "accent-hover", "dock-accent-active": "accent-active", "dock-border": "border-control", "addon-running": "success", "addon-pinned": "accent" })) {
    if (!Object.hasOwn(tokens, token)) tokens[token] = tokens[fallback];
  }
  return Object.freeze({ version: 1, tokens: Object.freeze(tokens), css: `:root {${[...REQUIRED_TOKENS, ...OPTIONAL_TOKENS].map(token => `--aperture-${token}:${tokens[token]};`).join("")}}` });
}
module.exports = { REQUIRED_TOKENS, OPTIONAL_TOKENS, validateTheme };
