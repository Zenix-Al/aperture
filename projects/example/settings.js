// Original schema descriptor format. No product defaults or migration history.
export default {
  schemaVersion: 1,
  migrations: [],
  schema: {
    exampleEnabled: { type: "boolean", defaultValue: true, exportable: true },
    preferences: {
      type: "object", defaultValue: { pageSize: 20, token: "" }, exportable: true,
      properties: {
        pageSize: { type: "number", defaultValue: 20, min: 1, max: 100, integer: true },
        token: { type: "string", defaultValue: "", maxLength: 200, sensitive: true },
      },
      additionalProperties: false,
    },
  },
};
