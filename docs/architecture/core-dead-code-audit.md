# Core source audit

The current [core source report](../../audits/core-size-baseline.json) records source graph, exports, import consumers and bundle contributions. An orphan or unreferenced export is a review hint, not permission to remove a module: generated feature discovery, settings metadata, string/event access, documented contracts and tests may consume it.

Development follows the [architecture guide](../guides/architecture.md); use the existing factories and resource owners.
