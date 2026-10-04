# Core size measurements

The current [core report](../../audits/core-size-baseline.json) measures source and actual bundled output through the project build inputs. Source measurements normalize line endings; generated output measurements use the real builders. Readable and minified scripts are different artifacts and should be compared with the same build mode.

```powershell
npm run check:core
npm run check:css
npm run check:addons:size
npm run build:core:smoke
```

Checks compare current reports without resetting accepted thresholds. Smoke builds use temporary outputs and preserve project versions and distributions. See [Build and test](../guides/build-test.md).
