// Browser polyfills, imported first in main.tsx so SDK imports see Buffer.
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
