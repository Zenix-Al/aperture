# Accepted framework audit evidence

These deterministic reports and fixed size references are CI inputs, separate from [authoring documentation](../docs/README.md). Generated Markdown here summarizes the machine-readable inventories.

`npm run audit:core`, `npm run audit:css`, `npm run audit:addons`, `npm run audit:addons:api` and `npm run audit:addons:size` write proposed reports to ignored `.artifacts/audits/`. Review their differences before changing accepted files. `npm run check:core`, `check:css`, `check:addons:api`, `check:addons:baseline` and `check:addons:size` read the accepted files without rewriting them.

After reviewing an intentional source or contract change, update its reports explicitly, in dependency order:

```powershell
node scripts/addon-api-audit.cjs --json audits/addon-api-audit.json --markdown audits/addon-api-audit.md
node scripts/addon-baseline.cjs --output audits/addon-baseline.json
node scripts/addon-service-size-audit.cjs --output audits/addon-service-size-audit.json --markdown audits/addon-service-size-audit.md
node scripts/core-source-audit.cjs --output audits/core-size-baseline.json
node scripts/css-audit.cjs --output audits/css-audit.json
```

Regenerating a measured inventory does not authorize loosening fixed numerical references or growth limits. Those require their own reviewed rationale. Tests and temporary smoke builds preserve distributions and versions.

After changing the framework version in root `package.json`, refresh the add-on service size and core size reports using the commands above. Builds embed this version in core UI and diagnostics, so even a version-only change can alter compressed bundle measurements. Run the report checks after the version update.
