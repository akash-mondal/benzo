import {execFileSync,spawn,spawnSync} from "node:child_process";
import {appendFileSync,readFileSync,existsSync} from "node:fs";
import path from "node:path";
import { repoRoot } from "../manifest/root";
import { vaultDir, scanBin, pcztBin, ufvkFile } from "../manifest/paths";
export const ROOT=repoRoot();
for(const l of (existsSync(path.join(ROOT,".env"))?readFileSync(path.join(ROOT,".env"),"utf8"):"").split("\n")) {const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2]}
export const STATE=path.resolve(ROOT,process.env.BNZ_STATE_DIR!),bin=(n:string)=>path.join(STATE,"bin",n);
export const env=(n:string)=>{const v=process.env[n];if(!v)throw Error(`missing ${n}`);return v};
export function run(cmd:string,args:string[],input?:string|Buffer):string {
  const p=spawnSync(cmd,args,{input,encoding:"utf8",maxBuffer:64<<20});
  appendFileSync(path.join(STATE,"run","settle-cli.log"),`\n${path.basename(cmd)}\n${p.stdout??""}${p.stderr??""}`);
  if(p.error)throw p.error;if(p.status!==0)throw Error(`${path.basename(cmd)} exited ${p.status}: ${(p.stderr||p.stdout).trim().slice(-300)}`);return p.stdout;
}
// Head (2026-10-03, live run 14): the public lightwalletd sits behind a load balancer whose backends can be a few
// blocks apart ("GetBlock: block N is newer than the latest block"); a wallet sync retries 4x with backoff on that
// and on transient endpoint errors. Every other wallet command is unchanged.
const SYNC_TRANSIENT=/newer than the latest block|past the valid range|Code: (Internal|Unavailable)|backing node|connection reset/;
export function syncRetry(f:()=>string):string {
  for(let attempt=1;;attempt++) {
    try{return f()}catch(e){if(attempt>=4||!SYNC_TRANSIENT.test(String((e as Error)?.message??e)))throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000*attempt)}
  }
}
export const wallet=(...args:string[])=>args[0]==="sync"?syncRetry(()=>run(bin("zcash-devtool"),["wallet","-w",vaultDir(STATE),...args])):run(bin("zcash-devtool"),["wallet","-w",vaultDir(STATE),...args]);
export const pczt=(...args:string[])=>run(bin("zcash-devtool"),["pczt","-w",vaultDir(STATE),...args]);
// §11 H7: under host custody the coordinator only ever holds the redacted candidate (allowRedacted).
export const inspect=(file:string,net:string,allowRedacted=false)=>JSON.parse(run(pcztBin(ROOT,STATE),["inspect",file,ufvkFile(STATE),...(allowRedacted?["--allow-redacted"]:[]),"--network",net]));
export const monetary=(id:string)=>JSON.parse(run(process.execPath,[path.join(ROOT,"settle/dist/plan.mjs"),id]));
// R33 P2-1 (G-7): the scanner runs on the signed manifest's network — never a hardcoded one.
export const notes=(net:string)=>run(scanBin(ROOT,STATE),["scan",net,vaultDir(STATE)]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
export function prove(file:string,output:string):Promise<void> {
  return new Promise((resolve,reject)=> {
    const p=spawn(bin("zcash-devtool"),["pczt","-w",vaultDir(STATE),"prove",file,"--output",output]);
    let log="";p.stdout.on("data",d=>log+=d);p.stderr.on("data",d=>log+=d);p.on("error",reject);
    p.on("close",code=>{appendFileSync(path.join(STATE,"run","settle-cli.log"),`\nprove\n${log}`);code===0?resolve():reject(Error(`prove exited ${code}: ${log.slice(-300)}`))});
  });
}
export async function mined(txid:string,deadline:number) {
  for(;;) {
    wallet("sync","-s",env("BNZ_LWD_URL"));
    const t=JSON.parse(wallet("list-tx","--json")).find((t:any)=>t.txid===txid);
    if(t?.mined_height)return t.mined_height as number;
    if(Date.now()>deadline)throw Error(`deadline waiting for mined settlement ${txid}`);
    await new Promise(r=>setTimeout(r,15000));
  }
}
// Head (2026-10-03, live run 10 died on one "error receiving data from backing node"): transient endpoint errors
// (Internal, Unavailable, DeadlineExceeded, backend/connection failures) are retried 4 times with backoff;
// NotFound and every other answer are returned or thrown unchanged.
const TRANSIENT_GRPC = /Code: (Internal|Unavailable|DeadlineExceeded|Unknown)|backing node|connection reset|EOF/;
// Head (2026-10-04, NU7 on testnet): settlement normally requires two independent lightwalletd endpoints to agree.
// While only one public testnet endpoint serves NU7, BNZ_LWD_SINGLE=1 runs on the primary alone: testnet only,
// warned on stderr and recorded in the settlement summary (lwd_endpoints). Mainnet always needs both.
export function lwdEndpoints(network: string): string[] {
  if (process.env.BNZ_LWD_SINGLE === "1") {
    // R28 item 10 (F7/G-7): keyed on the SIGNED manifest's network, never an env default.
    if (network !== "test") throw new Error("BNZ_LWD_SINGLE is testnet-only; mainnet settlement needs two endpoints");
    process.stderr.write(`WARN single lightwalletd endpoint ${env("BNZ_LWD_URL")} (BNZ_LWD_SINGLE=1, testnet): no second-endpoint agreement\n`);
    return [env("BNZ_LWD_URL")];
  }
  return [env("BNZ_LWD_URL"), env("BNZ_LWD_URL_ALT")];
}
// Phase 6 scale, measure first (docs/design/phase6-scale.md §2): settlement phase timings, one JSON line each in
// state/run/settle-timing.jsonl ({at, auction, batch, phase, ms, ...}). Never contains a destination or a key.
export function timing(rec: Record<string, unknown>): void {
  try { appendFileSync(path.join(STATE, "run", "settle-timing.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n"); } catch { /* timing is best-effort */ }
}
export const isTransientGrpc = (e: unknown) => TRANSIENT_GRPC.test(String((e as Error)?.message ?? e));
function retryTransient<T>(f:()=>T):T {
  for (let attempt = 1; ; attempt++) {
    try { return f(); } catch (e) {
      if (attempt >= 4 || !TRANSIENT_GRPC.test(String((e as Error)?.message ?? e))) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000 * 2 ** (attempt - 1));
    }
  }
}
export function chainTx(txid:string,endpoint:string) {
  const hash=Buffer.from(txid,"hex").reverse().toString("base64");
  return JSON.parse(retryTransient(()=>run(bin("grpcurl"),["-import-path",path.join(STATE,"proto"),"-proto","service.proto","-d",JSON.stringify({hash}),endpoint,"cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction"])));
}
