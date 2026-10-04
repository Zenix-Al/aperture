# Run and build Reading Desk

Reading Desk is a local demonstration project. It has Reading and Shelf routes, two core features, persisted settings, a custom Reading tab and a bookmark add-on.

## Build installable scripts

From the repository root:

```powershell
npm ci
npm run build -- --config projects/reading-desk/config.json
npm run build:addons -- --config projects/reading-desk/config.json
npm run demo:reading
```

Open `http://localhost:4173/reading/one`. Install these files in your userscript manager:

- `projects/reading-desk/dist/reading-desk.user.js`
- `projects/reading-desk/dist/bookmark.user.js`

Reload the page. The minified core output is an alternative to the readable file; install one core, not both. Builds do not bump versions by default. The local server also provides temporary script links if you prefer installing those; it never auto-injects the scripts. Stop the server with Ctrl+C. After changing source, restart the server and reinstall its core script from `http://localhost:4173/scripts/core.user.js`, then reload. Restarting the server alone does not update the copy installed in your manager. The Settings footer and Feature Health diagnostic show the bundled framework version.

Use localhost rather than 127.0.0.1: the script headers and routes select localhost on port 4173. Manager local-origin permissions may need enabling. Check header matches before installation.

## Exercise the project

1. The reading helper and bookmark panel appear on Reading routes.
2. Open core settings. General contains the shared controls; Reading contains the helper toggle and custom status panel; Add-ons contains add-on management.
3. Disable/re-enable the helper and reload to check persistence.
4. Save a bookmark, open its add-on settings, and disable/re-enable the add-on.
5. Navigate to Shelf: reading resources disappear and reading-scoped bookmark writes are denied. Return to Reading to enable them again.

For the alternate theme, run `npm run demo:reading -- --light` and install the temporary scripts linked by that server. Theme selection is build-time, so reinstall the selected outputs.

## Automated checks

```powershell
npx playwright install chromium
node --test tests/reading-desk.test.cjs tests/reading-desk-browser.test.cjs
```

Chromium uses the actual builders and a GM stand-in on a local HTTP server. This verifies fixtures, not an installed manager. See [troubleshooting](troubleshooting.md), [create your own project](../guides/create-project.md) and [build/test commands](../guides/build-test.md).
