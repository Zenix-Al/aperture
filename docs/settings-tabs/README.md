# Project settings tabs

Declare custom sidebar tabs in the project module selected by `build.ui`, normally `projects/<project>/ui.js`. Global controls live in the permanent General tab; Add-ons is also permanent. Project tabs follow them, ordered by ascending `order` (default 0), with declaration order breaking ties. Labels are rendered as text.

`tabs` is an array of metadata. Each tab has a unique `id`, a `label`, optional `order`, a `sections` map and/or a `component`. Section IDs are unique across tabs. IDs begin with a lowercase letter and contain letters, digits, underscores or hyphens, up to 64 characters; core and prototype-related IDs are reserved. Unknown tab/section fields and invalid mount hooks are rejected.

Reading Desk demonstrates both styles in [ui.js](../../projects/reading-desk/ui.js):

```js
import { createToggleSetting } from "../../src/ui/settings/metaFactory.js";
import readingPanel from "./ui/reading.js";
export default {
  tabs: [{
    id: "reading", label: "Reading", order: 10,
    sections: {
      readingControls: {
        label: "Reading helper",
        settings: {
          readingEnabled: createToggleSetting({ text: "Show reading helper", config: "readingEnabled" })
        }
      }
    },
    component: readingPanel
  }]
};
```

Keep persistent descriptors/defaults in the project `settings.js`. Metadata config paths must exist in that schema. Generated section containers use the contribution registry, renderers, validation, safe persistence and effects. Features can use the existing `contributeToSection("readingControls", metadata)`; authors do not add containers to shared HTML.

Rich components belong beside the project's UI input, such as [ui/reading.js](../../projects/reading-desk/ui/reading.js). Export an object with `mount({ container, signal, ownerId, resources, listen })` that returns a cleanup function, directly or asynchronously. Use `listen(id, target, type, callback, options)` for owned listeners and `resources.register(id, dispose)` for other owned resources. These delegate to the existing core registries. IDs are scoped to the component owner.

A component mounts once per settings UI lifetime. Closing the modal hides it; full UI teardown aborts its signal, runs cleanup, releases its resources and empties its container. After awaiting, check `signal.aborted` before changing DOM. A cleanup function returned after teardown is still invoked; late listener registration is ignored and late resource registration disposes immediately. A failing component reports through existing Feature Health and shows a bounded error in its own panel; other tabs remain usable.

Legacy `sections` contributions remain supported under General, and legacy `sectionContainers` keys receive generated containers. Explicit container IDs are no longer required. Legacy `panels` cannot hide core tabs. Optional project hooks and number policy retain their existing roles. The shared shell and rich Add-ons panel remain core-owned.

Use [Build and test](../guides/build-test.md) for current validation commands. Unit tests cover metadata rendering and HTML compaction; browser tests cover navigation, component cleanup and permanent core tabs.
