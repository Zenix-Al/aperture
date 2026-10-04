import { stateManager } from "../config/state.js";

export function getShadowRoot() {
  return stateManager.get("shadowRoot");
}

export default getShadowRoot;
