# Create a site project

A project combines a site configuration with features and settings. Start with the working [Reading Desk example](../example/quickstart.md), then replace its site inputs. The following steps create `projects/my-site/` without copying build output or old catalog caches.

## 1. Prepare the workspace

From the repository root:

```powershell
npm ci
New-Item -ItemType Directory -Force projects/my-site
Copy-Item projects/reading-desk/config.json projects/my-site/config.json
Copy-Item projects/reading-desk/application.js projects/my-site/application.js
Copy-Item projects/reading-desk/version.json projects/my-site/version.json
```

The copied application uses the existing composition in `projects/example/application.js`: storage bootstrap, core UI and the add-on service. Keep these owners; add site policy through project inputs. The other files below are new project files.

## 2. Define the site and output paths

Replace `projects/my-site/config.json` with this template, changing the example domain and public metadata to your site:

```json
{
  "schemaVersion": 1,
  "id": "my-site",
  "storageNamespace": "my_site",
  "metadata": {
    "name": "My Site Helper",
    "namespace": "https://example.org/my-site",
    "description": "A site helper built with Aperture",
    "author": "Your name",
    "license": "MIT",
    "matches": ["https://example.org/*"],
    "grants": ["GM.getValue", "GM.setValue", "GM.deleteValue"],
    "runAt": "document-start"
  },
  "build": {
    "entry": "src/main.js",
    "application": "projects/my-site/application.js",
    "settings": "projects/my-site/settings.js",
    "ui": "projects/my-site/ui.js",
    "featuresDir": "projects/my-site/features",
    "featureManifest": "projects/my-site/generated/features.generated.js",
    "versionFile": "projects/my-site/version.json",
    "outputDir": "projects/my-site/dist",
    "outputName": "my-site",
    "addonsManifest": "projects/my-site/addons.manifest.json",
    "catalogDir": "projects/my-site/generated/catalog",
    "cacheFile": "projects/my-site/generated/addon-build-cache.json"
  },
  "routes": { "isMySite": { "hostEquals": ["example.org"] } },
  "theme": "default",
  "addonUpdates": {}
}
```

Header `matches` decides where the manager executes the script; `routes` decides feature applicability within those pages. A core feature uses `pageScopes: ["isMySite"]`. An add-on uses the derived scope `"mySite"`. Keep the project ID and storage namespace stable after installation to retain data. Display-name changes do not change storage identity.

Create `projects/my-site/addons.manifest.json` with `{"addons": []}`. This selects no add-on scripts; the shared Add-ons tab remains available. Later add-ons must be explicitly listed.

## 3. Add settings and a settings tab

Create `projects/my-site/settings.js`:

```js
export default {
  schemaVersion: 1,
  migrations: [],
  schema: {
    helperEnabled: { type: "boolean", defaultValue: true, exportable: true }
  },
  effects: {
    getMetadataByConfigPath: path => path === "helperEnabled" ? { id: "helperEnabled" } : null,
    applyEffects: async () => (await import("../../src/loader.js")).reconcileFeatures()
  }
};
```

Create `projects/my-site/ui.js`:

```js
import { createToggleSetting } from "../../src/ui/settings/metaFactory.js";
export default {
  zIndex: 100000,
  tabs: [{
    id: "site", label: "Site",
    sections: {
      siteControls: {
        label: "Site helper",
        settings: {
          helperEnabled: createToggleSetting({ text: "Enable site helper", config: "helperEnabled" })
        }
      }
    }
  }]
};
```

Do not redeclare core-owned `globalSettings` or `addons`. See [settings/UI](settings-ui.md) for rich panels, persistence and layers.

## 4. Implement the feature

Create `projects/my-site/features/helper/index.js` using the complete example in [feature authoring](features.md). The exported name ends in `Feature`; config path and page scope match the files above. Replace the small demonstration DOM behavior with your site's selectors and actions.

## 5. Generate, check and build

```powershell
node -e "require('./scripts/featureManifest.cjs').generateProjectFeatureManifest({configFile:'projects/my-site/config.json'})"
node scripts/check-feature-manifest.cjs --config projects/my-site/config.json
node scripts/addon-catalog.cjs --config projects/my-site/config.json --write
npm run build -- --config projects/my-site/config.json --smoke
npm run build -- --config projects/my-site/config.json
```

Install `projects/my-site/dist/my-site.user.js` in your userscript manager. Visit a matching page, open Site settings, toggle the helper, reload, and navigate between applicable/nonapplicable routes. Ordinary builds do not bump the version. Add tests for your selectors, route matching, setting effects and cleanup before distributing.

See [build/test commands](build-test.md), [config reference](../build/project-config.md) and [add-on authoring](addons.md).

