// Hands the DMS projection to the classic renderer script.
//
// `renderer.ts` has no imports by design, so it cannot reach an ES module
// directly. This bridge is the only thing that does. It adds no behaviour: it
// exposes the projection under the same "may be undefined" idiom the preload
// globals already use, because module scripts are deferred and the classic
// script parses first.
import { renderBoundary } from "./encoding-visibility.js";

(globalThis as unknown as { renderBoundary?: typeof renderBoundary })
  .renderBoundary = renderBoundary;
