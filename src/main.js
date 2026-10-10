import { application } from "./application.js";
import { waitForBodyReady } from "./utils/dom";
import { detectPage } from "./core/pageDetection.js";
import { createBootstrapFailureHandler, runBootstrapPipeline } from "./core/bootstrap.js";

import {
  loadBodyBootstrapFeatures,
  loadFastBootstrapFeatures,
  reconcileFeatures,
  refreshFastBootstrapFeatures,
} from "./loader";
import { addListener } from "./core/listenerRegistry.js";
import {
  markRuntimeRunning,
  markRuntimeStarting,
  registerTeardownResetter,
  resumeRuntime,
  suspendRuntime,
  teardownAll,
} from "./core/teardown.js";
import { initGlobalErrorListeners } from "./core/featureFactory.js";
import { initRouteObserver } from "./core/routeObserver.js";
import { beginRoute, getRouteContext } from "./core/routeState.js";
import { createPageLifecycleHandlers } from "./core/pageLifecycle.js";
import { createResourceOwner, resourceManager } from "./core/resourceManager.js";

let globalTeardownHooksRegistered = false;
let startupPromise = null;
let readinessPromise = null;
let bodyFeaturesReady = false;
const refreshAddonSecurityPolicies = (context) => application.extensions?.refresh?.(context);
const showStorageUpgradeNotice = (error) => application.onStorageFailure?.(error);

function startStorageBootstrap() {
  if (!readinessPromise) {
    if (typeof application.ensureReady !== "function") throw new Error("Project must supply required config/storage readiness");
    readinessPromise = Promise.resolve().then(() => application.ensureReady()).then(snapshot => {
      if (!["ready", "degraded-readonly"].includes(snapshot?.state)) throw new Error("Project readiness must settle ready or degraded-readonly");
      return snapshot;
    });
  }
  return readinessPromise;
}

async function startRequiredStorageBootstrap() {
  try {
    return await startStorageBootstrap();
  } catch (error) {
    try { showStorageUpgradeNotice(error); } catch { /* Failure notice is optional; readiness remains failed. */ }
    throw error;
  }
}

const { handlePageHide, handlePageShow } = createPageLifecycleHandlers({
  suspendRuntime, teardownAll, resumeRuntime, beginRoute, detectPage,
  refreshFastBootstrapFeatures,
  reconcileFeatures: (context) => bodyFeaturesReady ? reconcileFeatures(context) : Promise.resolve({ status: "pending-body", transitions: 0 }),
  refreshAddonSecurityPolicies,
});

registerTeardownResetter(() => {
  globalTeardownHooksRegistered = false;
  startupPromise = null;
  readinessPromise = null;
  bodyFeaturesReady = false;
});

function registerGlobalTeardownHooks() {
  if (globalTeardownHooksRegistered) return;
  globalTeardownHooksRegistered = true;
  addListener("global-teardown-pagehide", window, "pagehide", handlePageHide);
  addListener("global-pageshow", window, "pageshow", handlePageShow);
}

async function runFastBootstrap() {
  // Classification rationale: route/config prerequisites are required;
  // diagnostics and extension initialization are optional; early work
  // and route observation have explicit degraded fallbacks.
  return runBootstrapPipeline([
    {
      id: "registerGlobalTeardownHooks",
      classification: "required",
      timeoutMs: 5000,
      run: () => registerGlobalTeardownHooks(),
    },
    {
      id: "storageBootstrap",
      classification: "required",
      timeoutMs: 15000,
      run: () => startRequiredStorageBootstrap(),
    },
    {
      id: "beginRoute",
      classification: "required",
      timeoutMs: 5000,
      run: () => beginRoute(),
    },
    {
      id: "detectPage",
      classification: "required",
      timeoutMs: 5000,
      run: () => detectPage(),
    },
    {
      id: "initGlobalErrorListeners",
      classification: "optional",
      timeoutMs: 5000,
      run: () => initGlobalErrorListeners(),
    },
    {
      id: "initRouteObserver",
      classification: "recoverable",
      timeoutMs: 5000,
      run: () =>
        initRouteObserver(async (routeContext) => {
          detectPage(window.location, routeContext);
          const currentContext = getRouteContext();
          await refreshFastBootstrapFeatures(currentContext);
          if (!bodyFeaturesReady) return { status: "pending-body", transitions: 0 };
          const result = await reconcileFeatures(currentContext);
          if (result.status !== "stale") await refreshAddonSecurityPolicies(currentContext);
          return result;
        }),
      fallback: () => null,
    },
    {
      id: "loadFastBootstrapFeatures",
      classification: "recoverable",
      timeoutMs: 10000,
      run: () => loadFastBootstrapFeatures(getRouteContext()),
      fallback: () => null,
    },
    {
      id: __APERTURE_ADDONS__ ? "initAddonsConsoleBridge" : "initExtensions",
      classification: "optional",
      timeoutMs: 5000,
      run: () => application.extensions?.init?.(),
    }
  ]);
}

async function runBodyBootstrap() {
  // Validated config and page detection are required. UI/toasts are optional,
  // while feature loading may degrade because individual features remain
  // independently diagnosable and retryable.
  const summary = await runBootstrapPipeline([
    {
      id: "storageBootstrap",
      classification: "required",
      timeoutMs: 15000,
      run: () => startRequiredStorageBootstrap(),
    },
    {
      id: "detectPage",
      classification: "required",
      timeoutMs: 5000,
      run: () => detectPage(undefined, beginRoute()),
    },
    {
      id: "initUiPhaseIfApplicable",
      classification: "optional",
      timeoutMs: 10000,
      run: () => application.ui?.init?.(),
    },
    {
      id: "flushQueuedToasts",
      classification: "optional",
      timeoutMs: 5000,
      run: () => application.ui?.flushToasts?.(),
    },
    {
      id: "loadBodyBootstrapFeatures",
      classification: "recoverable",
      timeoutMs: 15000,
      run: () => {
        bodyFeaturesReady = true;
        return loadBodyBootstrapFeatures(getRouteContext());
      },
      fallback: () => null,
    },
  ]);
  if (summary.status !== "failed") markRuntimeRunning();
}

export function startRuntime() {
  if (startupPromise) return startupPromise;
  markRuntimeStarting();
  const bodyController = new AbortController();
  const bodyOwner = createResourceOwner("core:body-ready");
  bodyOwner.register("body-ready", () => bodyController.abort(new DOMException("Runtime stopped", "AbortError")));
  const bodyReady = waitForBodyReady({ signal: bodyController.signal })
    .finally(() => resourceManager.unregister("body-ready"));
  const fastBootstrap = runFastBootstrap().catch(createBootstrapFailureHandler("fast-bootstrap"));
  startupPromise = Promise.all([
    fastBootstrap,
    Promise.all([bodyReady, fastBootstrap])
      .then(([, summary]) => summary?.status === "failed" || summary?.cancelled ? null : runBodyBootstrap())
      .catch((error) => {
        if (error?.name === "AbortError") return null;
        return createBootstrapFailureHandler("body-bootstrap")(error);
      }),
  ]);
  return startupPromise;
}

void startRuntime();
