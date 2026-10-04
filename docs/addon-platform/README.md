# Add-on platform contracts

For setup, source layout and commands, start with [add-on authoring](../guides/addons.md). The shared platform retains bridge, authorization, quotas, storage, UI and lifecycle owners. The active API has 29 generic descriptors; product descriptors and catalogs are outside the shipping graph.

## Project setup and trust

Reusable source stays in `addons/<id>/src/`; project-specific entries may live under `projects/<project>/`. The selected project's `build.addonsManifest`
lists the add-ons to build and authorize. The example selects
`projects/example/addons.manifest.json`; output stays under its project output
directory. Listing an add-on is an explicit project allowlist decision. Installing
or discovering an unlisted script does not authorize it. An empty catalog fails closed by default; persisted trust IDs cannot authorize scripts by themselves. The core service dialog can explicitly enable the default-off untrusted-add-on preference, retaining metadata/scope/capability checks and known-catalog identity validation.

Core-mode matches must fit the project matches; grants, matches, runtime mode,
version, scopes and capabilities are validated by the existing build tools.
Add-on versions remain independent of the core. Neither smoke command bumps them:

```powershell
npm run build:smoke
npm run build:addons:smoke
```

Optional `build.addons` selects a repository-contained policy module. Its default
export may provide `developmentAccess: true` for explicit local development,
project catalog/scopes policy, and `extensions`. The default grants no development
access and exposes no page-console facade. A supplied policy/catalog is trusted
project code; it is not a remote signature mechanism. The default catalog is
compiled from the validated selected manifest and needs no remote fetch.

Registration must use the catalog version, runtime mode and declared matches;
requested scopes/capabilities may be subsets, never expansions. Unknown
capabilities reject registration. Core requests require the intersection of
trust, enabled state, declared activation matches, current project route and
requested scopes. Scope names derive from route keys: `isExample` becomes
`example`. Management enable/disable remains distinct from runtime work; bounded
resource cleanup can run while disabled, out of scope or throttled. Privileged
writes still fail when trust is revoked.

## Wire contract and compatibility

The Aperture v1 contract has public API **0.1.0** and internal action
descriptor protocol **1** as distinct values. Add-ons must use the selected project identity, catalog and matching API contract.

Use the existing `addons/shared/coreBridge.js` client. Its shared constants now
come from `addons/shared/contract.js`, also used by the server. Event channels are
`aperture:<project-id>:<storage-namespace>:addons-command` and `:addon-command`.
The handshake order is ping, validate API/project identity, retain core instance
identity, bind commands, register the complete descriptor, query access, then
enable the serialized application lifecycle. Status transitions publish
status rather than re-registering stale descriptors.

Requests carry `type`, `marker`, `protocolVersion` (API string), `projectId`,
`instanceId`, `addonId`, `requestId`, `action`, object `payload`, and `replyEvent`.
Replies retain `{ok, reason?, value?, protocolVersion, addonId, requestId}` and add
project/instance correlation. Ping replies contain API, project and instance
identity. Wrong project/instance/version requests are rejected or ignored before
dispatch; malformed action envelopes return the bounded error format.
The client ignores mismatched replies. Replay retention remains 30 seconds with
128 entries. Default ping timeout is 1500 ms; client action timeout is 2500 ms;
descriptor timeout is 5000 ms. Actions such as observer waits can supply an
explicit client timeout. A client timeout alone does not cancel already dispatched
server work. Expired descriptor work cannot pass subsequent commit checks.

Lifecycle commands, registration panel/settings metadata, descriptor validators,
capability alternatives, ownership and result redaction remain APIs.
`dispose()` cancels pending client timers/listeners; terminal teardown invokes it.
Disable/re-enable and route suspension use the lifecycle and resource
registries. Route return resumes previously active add-ons without persisting a
route-driven disable as a user preference. Unregister and full teardown remain
terminal and forcibly clean core-owned resources.

## Actions, context and extensions

The platform exposes 29 generic descriptors. Families cover toast, feature lifecycle, storage, page context, observer, IndexedDB and UI. Management calls `addon.access` and `addon.throttle` remain available. Unknown actions fail deterministically. See the [API inventory](../../audits/addon-api-audit.json) for descriptors and consumers.

Project `extensions.families`, `dependencies`,
`actionFamilies`, and lifecycle callbacks add project actions through the original
composer; duplicate IDs and attempts to replace built-in families/dependencies
throw. Custom descriptors use the existing capability vocabulary. The selected
manifest rejects the product marker capability. Defining a new public capability
requires a separate build/contract change rather than bypassing validation.

`page.getContext` returns bounded hostname/path/search/hash/URL, route scopes,
page type and generation. Project `extensions.pageFields` receives bounded route
inputs and returns data under `fields`: detached JSON, depth 4, 256 visited values,
32 entries per collection, 512-character strings and an 8192-character total
bound. Live DOM objects, functions, unsafe property names and nonfinite numbers
are excluded. Additional site fields must be supplied explicitly by the project.

## Ownership, settings and theme

The core owns add-on mounts, dialogs, styles, dock controls and observer
subscriptions. Disable, route exit and teardown forcibly release them. Add-ons
own their local listeners, timers and pending operations through the existing
`addons/shared/runtimeLifecycle.js` and application cleanup callbacks. The
example retains all generic action families, bulk task cancellation, status,
settings, dock bindings and cleanup paths; it is not a replacement mini-demo.

storage limits remain 16 KiB per value, 64 KiB per add-on state; IDB
payloads 512 KiB and bulk batches 500 items; HTML 128 KiB; CSS 64 KiB; observer
subscriptions four per add-on. Existing rate/concurrency limits default to
100 requests per five seconds and 12 in flight. GM state and physical IDB names
use the selected project namespace and readiness/persistence queue.
Queued storage commits, schema upgrades and IDB transactions reauthorize at their
asynchronous boundaries. An already issued browser/GM write cannot be retroactively
revoked; checks prevent a subsequent unauthorized commit from starting.

The management/settings UI is retained with the local project catalog.
Its subscription and listeners belong to the existing registries. Example
settings persist through the registered panel controls and storage API.
Core-owned UI inherits the selected default/light tokens; local overrides remain
scoped by the sanitizer to the add-on's owned roots. Shared classes use the Aperture prefix; project identity determines host and resource IDs.
Standalone/hybrid scripts must implement their own local behavior and authored
fallback styles when core is absent. The example is core-required and does not
pretend to be a standalone runtime.

## Security limits and evidence

Page scripts can observe and forge CustomEvents, IDs, nonce/correlation fields,
registration, lifecycle commands and replies. These values separate projects and
stale instances; they do not authenticate a script. A hostile page can impersonate
an allowlisted add-on. Core authorization, payload bounds, sanitized HTML/CSS,
ownership and commit-time rechecks remain necessary. A broad userscript match or
an ID-only catalog is not an isolation boundary; local add-on grants are outside
the core's enforcement. No network/page-global action family is enabled by default.

Use [Build and test](../guides/build-test.md) for the API, ownership and browser checks. Chromium fixtures use a GM stand-in. Installed-manager sandbox/permissions, assistive technology and real BFCache behavior require manual verification.
