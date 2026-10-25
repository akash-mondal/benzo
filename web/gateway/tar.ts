// A minimal ustar writer + gzip: packs a public auction directory (regular files and subdirectories) under one top
// folder, so `curl … | tar -xz` gives the same tree `benzo verify --dir` reads. No dependency, same output on any OS.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

function header(name: string, size: number, type: "0" | "5"): Buffer {
  const h = Buffer.alloc(512);
  const put = (s: string, off: number, len: number) => h.write(s.slice(0, len), off, "utf8");
  let prefix = "";
  if (Buffer.byteLength(name) > 100) { const i = name.lastIndexOf("/", 155); prefix = name.slice(0, i); name = name.slice(i + 1); }
  put(name, 0, 100);
  put(type === "5" ? "0000755\0" : "0000644\0", 100, 8);
  put("0000000\0", 108, 8); put("0000000\0", 116, 8);
  put(size.toString(8).padStart(11, "0") + "\0", 124, 12);
  put("00000000000\0", 136, 12); // mtime 0: the same bytes every time
  h.fill(0x20, 148, 156);
  put(type, 156, 1);
  put("ustar\0", 257, 6); put("00", 263, 2);
  put(prefix, 345, 155);
  let sum = 0; for (const b of h) sum += b;
  put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return h;
}

export function tarDirectory(dir: string, top: string): Buffer {
  const chunks: Buffer[] = [];
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    for (const name of readdirSync(abs).sort()) {
      const r = rel ? `${rel}/${name}` : name, st = statSync(path.join(dir, r));
      if (st.isDirectory()) { chunks.push(header(`${top}/${r}/`, 0, "5")); walk(r); }
      else if (st.isFile()) {
        const data = readFileSync(path.join(dir, r));
        chunks.push(header(`${top}/${r}`, data.length, "0"), data, Buffer.alloc((512 - (data.length % 512)) % 512));
      }
    }
  };
  chunks.push(header(`${top}/`, 0, "5"));
  walk("");
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
