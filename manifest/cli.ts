// CLI: keygen <state key path>; sign <state key path> (manifest stdin); client <trusted signer hex> (packet stdin).
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { client, jsonBytes, requireThat, signRecord, validateManifest, type Manifest } from "./schema";
import { repoRoot } from "./root";

try {
  const [command, argument] = process.argv.slice(2);
  const root = repoRoot();
  const setting = process.env.BNZ_STATE_DIR ?? (existsSync(path.join(root,".env"))?readFileSync(path.join(root,".env"),"utf8"):"").match(/^BNZ_STATE_DIR=(.+)$/m)?.[1];
  requireThat(setting, "BNZ_STATE_DIR missing");
  const state = path.resolve(root, setting!);
  const keyPath = () => { const p = path.resolve(argument); requireThat(p.startsWith(state + path.sep), "key path must be under BNZ_STATE_DIR"); return p; };
  let result: unknown;
  if (command === "keygen") {
    const p = keyPath(); mkdirSync(path.dirname(p), {recursive:true,mode:0o700});
    const keys = generateKeyPairSync("ed25519");
    writeFileSync(p, keys.privateKey.export({type:"pkcs8",format:"pem"}), {flag:"wx",mode:0o600});
    result = { signer: keys.publicKey.export({type:"spki",format:"der"}).toString("hex") };
  } else if (command === "public") {
    result = { signer: createPublicKey(readFileSync(keyPath(),"utf8")).export({type:"spki",format:"der"}).toString("hex") };
  } else {
    const input = JSON.parse(readFileSync(0,"utf8"));
    if (command === "sign") { validateManifest(input as Manifest); result = signRecord(input,readFileSync(keyPath(),"utf8")); }
    else if (command === "client") result = client(input,argument);
    else throw new Error("usage: keygen <state key path> | sign <state key path> | client <trusted signer hex>");
  }
  process.stdout.write(jsonBytes(result));
} catch (e) { process.stderr.write(`ERROR manifest ${(e as Error).message}\n`); process.exitCode = 1; }
