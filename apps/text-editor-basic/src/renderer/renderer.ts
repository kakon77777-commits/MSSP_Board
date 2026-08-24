// A0 / packaged launch — the renderer's only script.
//
// Loaded as a separate file rather than inlined, because the CSP declares
// `script-src 'self'` and admits no inline source. That is the point: if this
// were a <script> block in the template it would need 'unsafe-inline', and a
// policy that permits inline script for the app's own convenience is a policy
// that permits inline script.
//
// No imports and no exports, so tsc emits plain browser-loadable JS rather than
// a CommonJS wrapper.
declare const appVersion: string | undefined;

const slot = document.getElementById("version");
if (slot) slot.textContent = typeof appVersion === "string" ? appVersion : "unavailable";
