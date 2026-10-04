export default {
  schemaVersion: 1,
  migrations: [],
  effects: {
    getMetadataByConfigPath: path => path === "readingEnabled" ? { id: "readingEnabled" } : null,
    applyEffects: async () => (await import("../../src/loader.js")).reconcileFeatures(),
  },
  schema: {
    readingEnabled: { type: "boolean", defaultValue: true, exportable: true },
  },
};
