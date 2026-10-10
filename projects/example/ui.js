import { createToggleSetting } from "../../src/ui/settings/metaFactory.js";
export default {
  panels: __APERTURE_ADDONS__ ? ["general", "addins"] : ["general"],
  sections: { global: {
    exampleEnabled: createToggleSetting({ text: "Enable example", config: "exampleEnabled" }),
    pageSize: { type: "number", text: "Page size", config: "preferences.pageSize", input: { min: 1, max: 100, step: 1 } },
  } },
};
