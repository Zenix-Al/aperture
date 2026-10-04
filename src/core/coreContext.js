// Inputs for the existing module graph, not another runtime or ownership graph.
// Each independently bundled application owns its original core singletons.
const buildId = typeof __APERTURE_PROJECT_ID__ === "string" ? __APERTURE_PROJECT_ID__ : "aperture";
let context = Object.freeze({
  id: buildId,
  getConfig: () => ({}),
  stateManager: null,
  pageDefinitions: {},
  notify: null,
  shutdownAddons: null,
});
let configuredId = null;

export function configureCoreContext(inputs = {}) {
  const allowed = new Set(["id", "getConfig", "stateManager", "pageDefinitions", "notify", "shutdownAddons"]);
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) throw new TypeError("Core context requires an object");
  for (const key of Object.keys(inputs)) if (!allowed.has(key)) throw new TypeError(`Unknown core input '${key}'`);
  if (inputs.id !== undefined) {
    if (typeof inputs.id !== "string" || !/^[a-z][a-z0-9_-]{1,63}$/.test(inputs.id)) throw new TypeError("Core identity requires a stable machine ID");
    if (configuredId && inputs.id !== configuredId) throw new Error("One core module graph cannot be shared by different applications; bundle each application independently");
  }
  for (const key of ["getConfig", "notify", "shutdownAddons"]) {
    if (inputs[key] !== undefined && !(key !== "getConfig" && inputs[key] === null) && typeof inputs[key] !== "function") throw new TypeError(`Core ${key} must be a function`);
  }
  if (inputs.stateManager !== undefined && (!inputs.stateManager || typeof inputs.stateManager.get !== "function" || typeof inputs.stateManager.set !== "function")) throw new TypeError("Core stateManager requires get/set");
  if (inputs.pageDefinitions !== undefined && (!inputs.pageDefinitions || typeof inputs.pageDefinitions !== "object" || Array.isArray(inputs.pageDefinitions))) throw new TypeError("Core pageDefinitions requires an object");
  context = Object.freeze({ ...context, ...inputs });
  if (inputs.id !== undefined) configuredId = inputs.id;
  return getCoreContext();
}

export function getCoreContext() {
  if (configuredId === null) configuredId = context.id;
  return context;
}
