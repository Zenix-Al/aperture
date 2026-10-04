# Reading Desk troubleshooting

| Symptom | Check and recovery |
| --- | --- |
| Build rejects config | Follow its field-path error. Use schema 1, supported keys, repository-relative paths, explicit metadata and an existing validated theme. Never supply function strings in JSON. |
| Feature absent or manifest stale | Regenerate/check the selected manifest using `configFile`/`--config`; export `*Feature` from the factory and use matching `isReading` scope and enabled config. |
| Local page loads but scripts do not | Confirm both scripts are installed/enabled, localhost port 4173 and reading/shelf header matches. Check manager local-site permissions. The server serves scripts for installation; it does not inject them. |
| Old UI or missing framework footer after restarting the demo | The server builds a snapshot at startup; installed manager scripts are separate copies. Restart the server, reinstall the temporary core from `http://localhost:4173/scripts/core.user.js`, then reload. Settings and Feature Health show the bundled Aperture version. |
| Add-on loads first or core absent | It waits up to 3 seconds for core. If core is unavailable it disposes the bridge and creates no UI/writes. Enable/install core and reload. |
| Bookmark blocked | Verify selected catalog version/ID, declared capabilities, reading-only matches/scope and persisted enabled state in Add-ins. A shelf route intentionally denies writes. Discovery does not authorize an add-on. |
| Storage read-only or save failed | Keep existing data. Check manager GM get/set/delete grants and storage probe/recovery status. Reads may work while writes are refused. Re-enable working grants and reload; do not delete data to bypass the write gate. |
| Theme rejected | Required default must exist; selection must contain the complete version-1 semantic token set in the allowed CSS shape. Fix build inputs and rebuild, rather than injecting unscoped CSS. |
| Port already in use | Stop the other local server. If changing port, update core/add-on matches and the server together. Do not silently grant all origins. |
| Different project sees no old settings | Stable project ID and storage namespace determine identity. A change starts fresh and leaves old data intact; revert the identity to access previous data. |

Use disposable sample data. Uninstall sample scripts through the manager. If
cleaning data manually, inspect and remove only the exact Reading Desk namespace
`aperture:reading-desk:reading_desk:` in that manager's storage; do not clear all
userscript data. The fixture's localStorage is only a test stand-in.

Report browser/manager version, generated script versions, route, safe readiness
or error reason, and reproduction steps. Do not include account values, tokens
or stored bookmarks. No Aperture support/release endpoint is configured yet.
