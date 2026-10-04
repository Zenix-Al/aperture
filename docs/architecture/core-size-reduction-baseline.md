# Core size comparison

The optional reduction audit compares the current non-add-on core footprint with the fixed numerical reference in `core-size-reduction-baseline.json`. Accepted thresholds remain unchanged. The comparison covers authored bytes, readable/minified bundle contributions and gzip measurements; add-on source and distributions are outside its scope.

```powershell
npm run audit:core:size-reduction
npm run check:core:size-reduction
```

The ordinary current-source check is `npm run check:core`. Use [Build and test](../guides/build-test.md) for validation and temporary smoke builds.
