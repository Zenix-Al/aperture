import { createToggleSetting } from "../../src/ui/settings/metaFactory.js";
import readingPanel from "./ui/reading.js";
export default {
  zIndex: 100000,
  tabs: [{
    id: "reading", label: "Reading", order: 10,
    sections: { readingControls: { label: "Reading helper", settings: {
      readingEnabled: createToggleSetting({ text: "Show reading helper", config: "readingEnabled" }),
    } } },
    component: readingPanel,
  }],
};
