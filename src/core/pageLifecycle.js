import { reportFeatureFailure, reportFeatureWarning } from "./featureHealth.js";

export function createPageLifecycleHandlers({
  suspendRuntime, teardownAll, resumeRuntime, beginRoute, detectPage,
  refreshFastBootstrapFeatures, reconcileFeatures, refreshAddonSecurityPolicies,
} = {}) {
  return {
    handlePageHide(event) {
      if (event?.persisted === true) return suspendRuntime("bfcache");
      return teardownAll("pagehide");
    },
    async handlePageShow(event) {
      if (!event?.persisted) return null;
      try {
        const routeContext = beginRoute(undefined, { force: true });
        resumeRuntime(routeContext);
        const pageFlags = detectPage(undefined, routeContext);
        const currentContext = pageFlags && typeof pageFlags === "object" ? { ...routeContext, pageFlags } : routeContext;
        try { await refreshAddonSecurityPolicies?.(currentContext); }
        catch (error) { reportFeatureWarning("Runtime", error, "bfcache.extensions"); }
        await refreshFastBootstrapFeatures(currentContext);
        return await reconcileFeatures(currentContext);
      } catch (error) {
        reportFeatureFailure("Runtime", error, "bfcache.resume");
        return { status: "failed", reason: "resume_failed" };
      }
    },
  };
}
