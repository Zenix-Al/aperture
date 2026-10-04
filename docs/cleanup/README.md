# Framework maintenance checks

Active tests cover shared architecture and the example projects. Core contract tests use explicit API and behavior assertions against Aperture; they do not require an archived checkout.

Run `npm run test:core` for core contracts, `npm test` for all unit tests and `npm run test:browser` for production-bundle browser fixtures.

Use [Build and test](../guides/build-test.md) for build, lint, metadata and size commands. `node scripts/run-checks.cjs tests` and `node scripts/run-checks.cjs static` capture checks under ignored `.artifacts/audits/`; `npm run check:all` runs both. Set `APERTURE_AUDIT_OUTPUT_DIR` to choose another evidence directory.
