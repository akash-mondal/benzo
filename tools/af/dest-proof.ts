import { inspect } from "node:util";
import { Destination } from "../../settle/destination";
const d = new Destination("utest1" + "q".repeat(60));
const out: string[] = [];
try { JSON.stringify({ row: { recipient: d } }); out.push("FAIL stringify did not throw"); } catch (e) { out.push(`ok stringify throws: ${(e as Error).message.slice(0, 40)}`); }
out.push(`${d}` === "[Destination]" ? "ok template prints [Destination]" : "FAIL template leaks");
out.push(inspect({ d }).includes("utest1") ? "FAIL inspect leaks" : "ok inspect hides it");
out.push(String(d) + "" === "[Destination]" ? "ok String()" : "FAIL String()");
out.push(d.reveal().startsWith("utest1") && d.equals(new Destination(d.reveal())) ? "ok reveal/equals" : "FAIL reveal");
out.push(Object.keys(d).length === 0 && !JSON.stringify(Object.entries(d)).includes("utest1") ? "ok no enumerable field" : "FAIL enumerable");
console.log(out.join("\n"));
