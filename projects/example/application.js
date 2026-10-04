// Original storage bootstrap owns readiness and persistence; UI/add-ons are later gates.
export default {
  state: { registeredAddons: [] },
  extensions: {
    init: async () => (await import("../../src/services/addonsService.js")).initAddonsConsoleBridge(),
    refresh: async () => (await import("../../src/services/addonsService.js")).refreshAddonSecurityPolicies(),
    shutdown: async () => (await import("../../src/services/addonsService.js")).shutdownAddonsService(),
  },
  ui: { init: async () => (await import("../../src/ui/index.js")).initUiPhaseIfApplicable(), flushToasts: async () => (await import("../../src/ui/components/toast.js")).flushQueuedToasts() },
  ensureReady: async () => {
    const { startStorageBootstrap } = await import("../../src/services/storageBootstrapService.js");
    return startStorageBootstrap();
  },
};
