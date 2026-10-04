// Preserved add-on schema descriptors, selected explicitly by projects.
// Product trust IDs are excluded; catalog policy owns authorization.
const node = (type, defaultValue, options = {}) => ({ type, defaultValue, ...options });
const string = (defaultValue, options = {}) => node("string", defaultValue, options);
const finiteNumber = (defaultValue, options = {}) => node("number", defaultValue, options);
const anyValue = node("any", {});
export const defaultAddonsApiThrottleSettings = { coreActionWindowMs: 5000, coreActionRateMax: 100, coreActionMaxConcurrent: 12 };
const defaultAddonsSettings = { trustedIds: [], byAddon: {}, installedMeta: {}, service: { disabled: false, allowUntrusted: false, apiThrottle: { ...defaultAddonsApiThrottleSettings } } };
const addonId = string("", { minLength: 1, maxLength: 128, pattern: /^[a-z0-9][a-z0-9_-]*$/i });
const addonState = node("object", {}, { additionalProperties: anyValue });
const addons = node("object", defaultAddonsSettings, {
  properties: {
    trustedIds: node("array", defaultAddonsSettings.trustedIds, { items: addonId, unique: true }),
    byAddon: node("object", {}, { keyPattern: /^[a-z0-9][a-z0-9_-]{0,127}$/i,
      additionalProperties: node("object", {}, {
        properties: { state: addonState },
        additionalProperties: false,
      }),
    }),
    installedMeta: node("object", {}, { keyPattern: /^[a-z0-9][a-z0-9_-]{0,127}$/i,
      additionalProperties: node("object", {}, {
        properties: {
          name: string("", { maxLength: 200 }),
          version: string("", { maxLength: 100 }),
          description: string("", { maxLength: 10000 }),
          panelTitle: string("", { maxLength: 200 }),
          panelBody: string("", { maxLength: 10000 }),
          statusMessage: string("", { maxLength: 500 }),
          pageScopes: node("array", [], { items: string("", { maxLength: 200 }) }),
          runtimeMode: string("", { maxLength: 50 }),
          matches: node("array", [], { items: string("", { maxLength: 1000 }) }),
          capabilities: node("array", [], { items: string("", { maxLength: 200 }), unique: true }),
          installedSeenAt: finiteNumber(0, { min: 0 }),
          lastSeenAt: finiteNumber(0, { min: 0 }),
        },
        additionalProperties: false,
      }),
    }),
    service: node("object", defaultAddonsSettings.service, {
      properties: {
        disabled: node("boolean", false),
        allowUntrusted: node("boolean", false, { exportable: false }),
        apiThrottle: node("object", defaultAddonsApiThrottleSettings, {
          properties: {
            coreActionWindowMs: finiteNumber(defaultAddonsApiThrottleSettings.coreActionWindowMs, { min: 250, max: 60000, integer: true }),
            coreActionRateMax: finiteNumber(defaultAddonsApiThrottleSettings.coreActionRateMax, { min: 1, max: 1000, integer: true }),
            coreActionMaxConcurrent: finiteNumber(defaultAddonsApiThrottleSettings.coreActionMaxConcurrent, { min: 1, max: 100, integer: true }),
          },
          additionalProperties: false,
        }),
      },
      additionalProperties: false,
    }),
  },
  additionalProperties: false,
});

export { addons as addonConfigSchema };
