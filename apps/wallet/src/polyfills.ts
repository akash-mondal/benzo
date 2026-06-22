// Browser polyfills, imported FIRST in main.tsx. ES modules fully evaluate each
// import before the next, so this runs before any module that references the Node
// `Buffer` global (the Stellar SDK, via @benzo/core) is evaluated. Setting it in
// main.tsx's body instead would be too late — the body runs after all imports.
import { Buffer } from "buffer";

// `globalThis` has no `Buffer` index signature in the browser TS lib; cast to assign.
const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
