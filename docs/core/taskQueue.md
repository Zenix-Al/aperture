# Task Queue (`taskQueue.js`)

The `taskQueue` module provides a way to process a sequence of tasks with a fixed delay, mitigating layout thrashing and CPU spikes.

## Creation
```javascript
import { createTaskQueue } from "../../core/taskQueue.js";

const queue = createTaskQueue({ delay: 100, name: "TileRenderer", ownerId: "feature:tiles" });
```

## Adding Tasks
Tasks use a unique key. Default `replace-pending` replaces pending duplicate work;
`drop-new` and `drop-old` are explicit alternatives. A running duplicate under
`replace-pending` is dropped. policy assertions remain in the suite.

```javascript
queue.add("render-tile-1", async ({ signal, generation }) => {
    // Heavy DOM work
}, generationId);
```

## Generations (Stale Work Invalidation)
The queue supports "generations". When navigating in an SPA, the generation increments. If the queue is processing a task from an older generation, it will drop it. This is essential for preventing the processing of DOM nodes that no longer exist on the screen.

```javascript
queue.setGeneration(newGenerationId);
```

## Lifecycle and policies

Queues run sequentially and return a promise for every accepted task. Configure
`duplicatePolicy` as `drop-new`, `drop-old`, or `replace-pending`, and configure
bounded backpressure with `maxPending` plus `drop-oldest`, `drop-new`, or `reject`.
Tasks receive `{ signal, key, queueName, ownerId, generation, enqueuedAt, startedAt }`.

Use `cancelPending()`, `cancelRunning()`, or `clear()` during teardown. `whenIdle()`
resolves the queue snapshot when idle. `drain()` returns its cancellation/
disposal-shaped result after idle; it is not an alias of `whenIdle()`. `snapshot()`
returns safe queue diagnostics. `dispose()` aborts active work, settles pending work as
cancelled, and releases the queue's owner-scoped resource registration.

Both debounce exports preserve last receiver/arguments and expose
`.cancel()` to release pending callbacks.
