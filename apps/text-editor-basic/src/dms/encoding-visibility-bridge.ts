// Hands the DMS projection to the classic renderer script, and asks for the
// first thing to project.
//
// `renderer.ts` has no imports by design, so it cannot reach an ES module
// directly. This bridge is the only thing that does.
//
// The initial handshake lives HERE rather than in renderer.ts, and that is the
// whole point of the file. Module scripts are deferred: the classic script
// finishes parsing first, so a handshake at the end of renderer.ts ran while
// `renderBoundary` was still undefined. It was written to tolerate that, so it
// swallowed the entire handshake and left the encoding row reading "-" — a
// window that looks exactly like one whose document has no format. The module
// that supplies the projection is the one that can safely ask for its input.
import { renderBoundary } from "./encoding-visibility.js";

declare const getDocumentFormatState: (() => Promise<Parameters<typeof renderBoundary>[0]>)
  | undefined;

(globalThis as unknown as { renderBoundary?: typeof renderBoundary })
  .renderBoundary = renderBoundary;

// Core 4.2: main is the only authority on the snapshot, and the renderer never
// derives a format of its own.
void (async () => {
  if (typeof getDocumentFormatState !== "function") return;
  try {
    renderBoundary(await getDocumentFormatState(), null);
  } catch (raised) {
    const slot = document.getElementById("error");
    if (slot !== null) slot.textContent = String(raised);
  }
})();
