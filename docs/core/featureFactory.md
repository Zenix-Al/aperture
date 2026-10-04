# Feature Factory (`featureFactory.js`)

The `featureFactory` is the heart of the mini-framework, dictating the lifecycle of every feature.

## What is it?
Instead of writing a feature as a standalone script, features are instantiated via `createFeature()` or `createStyledFeature()`. This wraps the feature in a standard interface.

- **`createFeature`**: Used for standard features with JavaScript logic.
- **`createStyledFeature`**: Uses the style registry and removes its style during disable, including rejected or synchronously throwing disable handlers. The default target is the page document; `styleTarget: "shadow"` uses the injected state manager's Shadow root. Handlers receive the same lifecycle context as `createFeature`.

## Standard Interface
When you create a feature, it returns an object with methods like:
- `enable(context?)`: Activates the feature and returns a promise that settles only after the requested state is reached, cancelled, or fails. It also checks whether the feature is applicable to the current page.
- `disable(context?)`: Deactivates the feature and returns an equivalent lifecycle promise.
- `toggle(shouldEnable, force)`: Helper to switch states.
- `isEnabled()`: Checks if the feature should be active based on configuration.
- `isApplicable()`: Checks if the feature is meant to run on the current page scope.

## Feature Options

Core state/config and optional notification are supplied through [core provider inputs](context.md), rather than imported from product modules. The core contract suite pins the named factory exports and feature methods.
When calling `createFeature(name, options)`, the options object expects:
- `id`: (String) Unique identifier for the feature.
- `configPath`: (String) Path in the config tree to determine if enabled.
- `enable`: (Function) The logic to run when activating.
- `disable`: (Function) The cleanup logic to run when deactivating.
- `isApplicable`: (Function) Returns boolean determining if the feature can run on the current page.
- `bootstrapMode`: (String) When to start (`waitForBody` or `fast`).
- `pageScopes`: (Array) List of valid route scopes.

## Error Handling
The factory wraps lifecycle transitions in `try/catch` and enforces an `OP_TIMEOUT` (15000ms). A newer requested transition aborts a prior one and waits briefly for it to settle before running, so stale work cannot update the final feature state. Every handler receives `{ signal, operationId, generation, routeGeneration, reason, featureId }`; asynchronous code must honour `signal` before committing DOM or state. If a feature fails to start, it is reported to the `featureHealth` subsystem and will not crash the rest of the script. Features can also use `reportError(err, phase)` to report runtime errors that occur outside the standard lifecycle.
