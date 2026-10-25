// Lets the page import the repo's own bid code (../envelope, ../manifest) unchanged: inside those folders only,
// node:crypto, node:fs and ./destination resolve to the browser shims next to this file.
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export function bidderShims(repoRoot: string) {
  const inRepo = (importer?: string) => !!importer && [path.join(repoRoot, "envelope"), path.join(repoRoot, "manifest"), path.join(repoRoot, "clear")].some((d) => importer.startsWith(d + path.sep));
  return {
    name: "benzo-bidder-shims",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!inRepo(importer)) return null;
      if (source === "node:crypto" || source === "crypto") return path.join(here, "shims/node-crypto.ts");
      if (source === "node:fs" || source === "fs") return path.join(here, "shims/node-fs.ts");
      if (source === "./destination" || source.endsWith("/envelope/destination")) return path.join(here, "shims/destination.ts");
      return null;
    },
  };
}
