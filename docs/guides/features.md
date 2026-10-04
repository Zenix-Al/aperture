# Write a feature

Create a module under the selected project's `build.featuresDir`. Export a named const ending in `Feature` from `createFeature` or `createStyledFeature`. The manifest generator discovers it; do not wire it manually into the loader.

For the project in [Create a site project](create-project.md), put this in `projects/my-site/features/helper/index.js`:

```js
import { createFeature } from "../../../../src/core/featureFactory.js";
import { createResourceOwner, releaseOwner } from "../../../../src/core/resourceManager.js";

const ownerId = "my-site:helper";
export const siteHelperFeature = createFeature("Site helper", {
  id: "site-helper",
  configPath: "helperEnabled",
  pageScopes: ["isMySite"],
  bootstrapMode: "waitForBody",
  enable(context) {
    if (context.signal.aborted) return;
    const owner = createResourceOwner(ownerId);
    const panel = document.createElement("aside");
    panel.textContent = "Site helper enabled";
    document.body.appendChild(panel);
    owner.register(ownerId + ":panel", () => panel.remove());
  },
  disable() {
    releaseOwner(ownerId);
  }
});
```

Use `waitForBody` for DOM work. `fast` is for bounded early work that does not depend on body. The factory receives cancellation and route-generation context, serializes transitions and reports failures through Feature Health. After every await, check `context.signal.aborted` before changing DOM or committing state.

| Resource or task | Existing owner/API |
| --- | --- |
| Element, timer or page patch | Resource manager; register a reversal and release it on disable |
| Event listener | Listener registry with your resource owner |
| Styles | `createStyledFeature` and the style registry |
| DOM mutations | `addObserverCallback` from the central observer |
| Large/repeated DOM collections | Task queue and frame-budget utilities |
| Page-owned globals | Page bridge, keeping userscript/page execution worlds separate |
| Persisted setting | `updateConfig` through the settings service |

For styled and cancellable DOM work, see the real [Reading Desk feature](../../projects/reading-desk/features/reading-helper/index.js). Consult [core modules](../core/index.md) for the detailed factory, observer, queue and registry APIs. Generated manifests are regenerated with the selected project's config, as shown in [build/test](build-test.md).

