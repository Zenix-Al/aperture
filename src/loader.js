// src/loader.js
import { application } from "./application.js";
import { debugLog } from "./core/logger";
import {
  listFeaturesByBootstrapMode,
  listRegisteredFeatures,
  registerFeature,
} from "./core/featureCatalog.js";
import { runFrameBudgeted } from "./core/frameBudget.js";
import { getFeatureStatus, reportFeatureFailure } from "./core/featureHealth.js";
import { TIMINGS } from "./config/timings.js";
import { generatedFeatures } from "./generated/features.generated.js";
import { featureMatchesPageScopes } from "./core/featureScope.js";
import { getRouteContext, isRouteContextCurrent } from "./core/routeState.js";
import { runBootstrapStep } from "./core/bootstrap.js";
import { reportFeatureWarning } from "./core/featureHealth.js";
import { registerTeardownResetter } from "./core/teardown.js";

const featureRegistry = generatedFeatures.map(registerFeature);
const featureRoutes = new Map();
registerTeardownResetter(() => featureRoutes.clear());

function registerFeatureSettingsUi(feature) {
  const settingsUi = feature?.settingsUi;
  if (!settingsUi || typeof settingsUi !== "object") return;

  const metaMaps = Array.isArray(settingsUi.metaMaps) ? settingsUi.metaMaps : [];
  if (metaMaps.length === 0) return;

  const sectionId = String(settingsUi.sectionId || "").trim();
  if (!sectionId) return;

  const ownerId = `feature:${String(feature.featureKey || feature.id || feature.name || "unknown").trim()}`;
  for (const metaMap of metaMaps) {
    try {
      application.settingsUi?.contributeToSection?.(sectionId, metaMap, ownerId);
    } catch (error) {
      reportFeatureWarning(feature.name, error, "loader.settings-ui");
    }
  }
}

featureRegistry.forEach(registerFeatureSettingsUi);

export function isFeatureAllowedOnCurrentPage(feature) {
  return featureMatchesPageScopes(feature);
}

function getFastBootstrapFeatures() {
  return listFeaturesByBootstrapMode("fast").filter(isFeatureAllowedOnCurrentPage);
}

function getBodyBootstrapFeatures() {
  // Fast bootstrap only runs project early work. The feature lifecycle
  // still runs after body is ready so DOM observers/subscriptions can start.
  return listRegisteredFeatures();
}

async function runFeatureRegistry(features, routeContext = null) {
  if (!Array.isArray(features) || features.length === 0) return;
  const work = [];
  const activeRoute = routeContext || getRouteContext();
  await runFrameBudgeted(features, (feature) => {
      try {
        if (!feature || typeof feature !== "object") return;
        if (typeof feature.isEnabled !== "function" || typeof feature.enable !== "function") return;
        if (isFeatureAllowedOnCurrentPage(feature) && feature.isEnabled()) {
          featureRoutes.set(feature, activeRoute.generation);
          work.push(feature.enable({ ...activeRoute, routeGeneration: activeRoute.generation }));
        }
      } catch (error) {
        reportFeatureFailure(feature?.name || "Feature Loader", error, "loader.enable");
        console.error(`[Loader] Failed to enable ${feature?.name || "feature"}:`, error);
      }
    }, {
      budgetMs: TIMINGS.LOADER_FEATURE_FRAME_BUDGET_MS,
      minChunk: TIMINGS.LOADER_FEATURE_MIN_CHUNK,
      startOnNextFrame: false,
      shouldContinue: () => activeRoute.generation === 0 || isRouteContextCurrent(activeRoute),
    });
  const results = await Promise.allSettled(work);
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
}

async function runEarlyWork(routeContext, phase) {
  const activeRoute = routeContext || getRouteContext();
  if (!application.earlyWork) return null;
  if (activeRoute.generation > 0 && !isRouteContextCurrent(activeRoute)) return { status: "stale" };
  const result = await runBootstrapStep({
    id: "projectEarlyWork", classification: "recoverable", timeoutMs: 10000,
    run: ({ signal }) => application.earlyWork({
      ...activeRoute, signal, phase, features: getFastBootstrapFeatures(),
      isCurrent: () => !signal.aborted && (activeRoute.generation === 0 || isRouteContextCurrent(activeRoute)),
    }),
    fallback: () => null,
  }, activeRoute);
  if (result.status !== "ok") reportFeatureWarning("Early Work", result.errorMessage, "loader.early-work", { correlationId: activeRoute.correlationId, routeGeneration: activeRoute.generation });
  return result;
}

export function loadFastBootstrapFeatures(routeContext = null) {
  const features = getFastBootstrapFeatures();
  debugLog("Loader", `Registering ${features.length} fast bootstrap feature(s)...`);
  return runEarlyWork(routeContext, "initial").then(result => {
    if (result && result.status !== "ok" && result.status !== "stale") throw new Error(result.errorMessage || "Early work degraded");
    return result;
  });
}

export function refreshFastBootstrapFeatures(routeContext = null) {
  return runEarlyWork(routeContext, "route");
}

export async function loadBodyBootstrapFeatures(routeContext = null) {
  const features = getBodyBootstrapFeatures();
  debugLog("Loader", `Running ${features.length} body bootstrap feature(s)...`);
  await runFeatureRegistry(features, routeContext);
}

export async function loadFeatures() {
  await loadBodyBootstrapFeatures();
}

export async function reconcileFeatures(routeContext = null) {
  const activeRoute = routeContext || getRouteContext();
  if (activeRoute.generation > 0 && !isRouteContextCurrent(activeRoute)) return { status: "stale", transitions: 0 };
  const transitions = [];
  const orderedFeatures = [
    ...listFeaturesByBootstrapMode("fast"),
    ...listFeaturesByBootstrapMode("waitForBody"),
  ];
  for (const feature of orderedFeatures) {
    if (activeRoute.generation > 0 && !isRouteContextCurrent(activeRoute)) break;
    if (!feature || typeof feature.isEnabled !== "function") continue;
    const shouldRun = isFeatureAllowedOnCurrentPage(feature) && feature.isEnabled();
    const status = getFeatureStatus(feature.name).status;
    const previousRoute = featureRoutes.get(feature);
    if (shouldRun && status === "running" && previousRoute !== undefined && previousRoute !== activeRoute.generation) {
      featureRoutes.set(feature, activeRoute.generation);
      transitions.push((async () => {
        await feature.disable({ ...activeRoute, routeGeneration: activeRoute.generation, reason: "route-change" });
        if (activeRoute.generation > 0 && !isRouteContextCurrent(activeRoute)) return;
        return feature.enable({ ...activeRoute, routeGeneration: activeRoute.generation, reason: "route-change" });
      })());
    } else if (shouldRun && status !== "running" && typeof feature.enable === "function") {
      featureRoutes.set(feature, activeRoute.generation);
      transitions.push(feature.enable({ ...activeRoute, routeGeneration: activeRoute.generation, reason: "route-change" }));
    } else if (!shouldRun && status !== "disabled" && typeof feature.disable === "function") {
      featureRoutes.delete(feature);
      transitions.push(feature.disable({ ...activeRoute, routeGeneration: activeRoute.generation, reason: "route-change" }));
    }
  }
  const results = await Promise.allSettled(transitions);
  if (activeRoute.generation > 0 && !isRouteContextCurrent(activeRoute)) return { status: "stale", transitions: transitions.length };
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  return { status: "completed", transitions: transitions.length };
}
