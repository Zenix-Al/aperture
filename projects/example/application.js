// Original storage bootstrap owns readiness and persistence; UI/add-ons are later gates.
export default {
  state: __APERTURE_ADDONS__ ? { registeredAddons: [] } : {},
  extensions: __APERTURE_ADDONS__ ? {
    init: async () => (await import("aperture:addon-service")).initAddonsConsoleBridge(),
    refresh: async () => (await import("aperture:addon-service")).refreshAddonSecurityPolicies(),
    shutdown: async () => (await import("aperture:addon-service")).shutdownAddonsService(),
  } : {},
  ui: { init: async () => (await import("../../src/ui/index.js")).initUiPhaseIfApplicable(), flushToasts: async () => (await import("../../src/ui/components/toast.js")).flushQueuedToasts() },
  ensureReady: async () => {
    const { startStorageBootstrap } = await import("../../src/services/storageBootstrapService.js");
    return startStorageBootstrap();
  },
};
