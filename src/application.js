// Project inputs for the original main/loader orchestration. No lifecycle here.
import project from "aperture:project";
import definition from "aperture:application";
import { config, stateManager } from "./config/state.js";
export { stateManager };
import { configureCoreContext } from "./core/coreContext.js";

if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
  throw new TypeError("Application definition must be an object");
}
for (const key of Object.keys(definition)) {
  if (!["routes", "state", "stateManager", "getConfig", "ensureReady", "onStorageFailure", "earlyWork", "settingsUi", "ui", "extensions"].includes(key)) {
    throw new TypeError(`Unknown application input '${key}'`);
  }
}
for (const key of ["getConfig", "ensureReady", "onStorageFailure", "earlyWork"]) {
  if (definition[key] !== undefined && typeof definition[key] !== "function") throw new TypeError(`${key} must be a function`);
}
for (const key of ["routes", "state"]) {
  if (definition[key] !== undefined && (!definition[key] || typeof definition[key] !== "object" || Array.isArray(definition[key]))) throw new TypeError(`${key} must be an object`);
}
if (definition.stateManager !== undefined && (!definition.stateManager || typeof definition.stateManager.get !== "function" || typeof definition.stateManager.set !== "function")) throw new TypeError("Application stateManager requires get/set");
for (const [group, keys] of Object.entries({ settingsUi: ["contributeToSection"], ui: ["init", "flushToasts", "notify"], extensions: ["init", "refresh", "shutdown"] })) {
  const value = definition[group];
  if (value === undefined) continue;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${group} must be an object`);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key) || typeof value[key] !== "function") throw new TypeError(`Invalid application hook ${group}.${key}`);
  }
}
const pageDefinitions = Object.freeze({ ...project.routes, ...definition.routes });
for (const [key, rule] of Object.entries(pageDefinitions)) {
  if (!/^is[A-Z][A-Za-z0-9]*$/.test(key) || !rule || typeof rule !== "object" || Array.isArray(rule)) throw new TypeError(`Invalid route definition '${key}'`);
}
export const application = Object.freeze({
  ...definition,
  id: project.id,
  pageDefinitions,
  stateManager,
});
configureCoreContext({
  id: project.id,
  stateManager,
  pageDefinitions,
  getConfig: definition.getConfig || (() => config),
  notify: definition.ui?.notify || null,
  shutdownAddons: definition.extensions?.shutdown || null,
});
