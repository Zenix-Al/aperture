# Project UI layers

Set `zIndex` in the project module selected by `build.ui`:

```js
export default {
  zIndex: 100000,
  tabs: [/* project tabs */]
};
```

Reading Desk supplies this value in [ui.js](../../projects/reading-desk/ui.js). Omission retains the base of 10000. Values must be integers from 1000 through 2147480437, leaving room below the browser's signed 32-bit ceiling.

| UI | Offset from base |
| --- | ---: |
| Floating add-on host | -1000 |
| Dock | 20 |
| Settings | 3000 |
| Core dialogs | 3100 |
| Add-on dialogs | 3120 |
| Toasts (Shadow and document fallback) | 3210 |

Layers are injected into framework-owned roots through the existing style registry. Add-on document hosts use the same derived values. Add-on dialogs now sit above core dialogs, below toasts. No page-wide CSS or new lifecycle is introduced. The core Shadow host does not establish another stacking context; owned hosts remain direct body children rather than children of a site's content containers.

A z-index cannot escape a stacking context or clipping established by the page's body/ancestor, and cannot outrank browser top-layer dialogs or fullscreen UI. Such sites need mounting/context investigation rather than a larger number. This input is public build-time configuration, separate from theme colors and persisted user settings; rebuild the selected project after changing it.

The theme browser suite exercises a dock click above a site overlay at z-index 50000 with project base 100000, derived settings/core/add-on dialog layers, fallback toast layering and teardown. Unit tests check default spacing, boundary values and invalid/overflow rejection. Use [Build and test](../guides/build-test.md) for validation commands; browser fixtures use a GM stand-in.
