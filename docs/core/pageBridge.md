# Page Bridge (`pageBridge.js`)

The `pageBridge.js` module transports page events between execution worlds. Events and markers are page-controlled; the primitive does not authenticate responses or authorize actions.

## Purpose
Userscripts generally run in an isolated sandbox to prevent conflicts with the host page's variables and functions. However, sometimes a feature absolutely *must* access a variable or function defined on the host page's `window` object (e.g., retrieving an authentication token, or interfacing with the forum's native JavaScript APIs).

Use explicit project-scoped marker/event names and validate page data. Keep authorization in the higher-level add-on/action machinery.

## Usage
*When building features, only use `pageBridge.js` if you absolutely need data that exists on the host's `window` object and cannot be retrieved through the DOM.*

`requestPageBridge` retains its request/result events, detail, timeout and
result shape. Optional `signal` cancels without dispatch when already aborted;
optional `ownerId` connects request cleanup to the existing resource manager.
Cancellation returns `received: false`, `reason: "bridge_aborted"`, `detail: {}`.
`subscribePageBridgeEvent(event, callback, { ownerId })` optionally uses that same
ownership graph. The returned disposer remains idempotent. Requests do not
provide authenticated correlation. See [core provider inputs](context.md).
