import { createStyledFeature } from "../../src/core/createStyledFeature.js";
import { createResourceOwner, releaseOwner } from "../../src/core/resourceManager.js";
import { addListener } from "../../src/core/listenerRegistry.js";
import { addObserverCallback } from "../../src/core/observer.js";
import { createTaskQueue } from "../../src/core/taskQueue.js";

function options(id, mode) {
  let queue;
  return {
    id, configPath: "enabled", bootstrapMode: mode, pageScopes: ["isArticle"],
    styleId: id, styleCss: `.runtime-${id} { color: rgb(128, 0, 128); }`, styleOwnerId: id,
    settingsUi: { sectionId: "articleTools", metaMaps: [{ [id]: { type: "checkbox", configPath: "enabled" } }] },
    async enable(context) {
      const fixture = globalThis.__runtimeFixture;
      fixture.trace.push(`enable:${id}:${context.routeGeneration}`);
      await fixture.enable?.(id, context);
      if (context.signal.aborted) throw new DOMException("Stale route", "AbortError");
      const owner = createResourceOwner(id);
      const button = document.createElement("button");
      button.className = `runtime-${id}`;
      button.dataset.runtimeFeature = id;
      button.textContent = id;
      document.body.append(button);
      owner.register(`${id}:mount`, () => button.remove());
      addListener(`${id}:click`, button, "click", () => fixture.clicks.push(id), undefined, id);
      addObserverCallback(`${id}:observer`, mutations => {
        if (mutations.some(mutation => mutation.target === document.body)) fixture.batches.push(id);
      }, { ownerId: id });
      queue = createTaskQueue({ name: id, ownerId: id, delay: 0 });
      await queue.add(`${id}:task`, () => {
        if (!context.signal.aborted) fixture.commits.push(`${id}:${context.routeGeneration}`);
      });
    },
    async disable(context) {
      globalThis.__runtimeFixture.trace.push(`disable:${id}:${context.routeGeneration}`);
      await queue?.dispose();
      releaseOwner(id);
      await globalThis.__runtimeFixture.disable?.(id, context);
    },
  };
}
export const runtimeFastFeature = createStyledFeature("Runtime Fast", options("runtime-fast", "fast"));
export const runtimeBodyFeature = createStyledFeature("Runtime Body", options("runtime-body", "waitForBody"));
