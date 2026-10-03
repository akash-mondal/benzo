import {execFileSync,spawn,spawnSync} from "node:child_process";
import {appendFileSync,readFileSync,existsSync} from "node:fs";
import path from "node:path";
import { repoRoot } from "../manifest/root";
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
export const wallet=(...args:string[])=>args[0]==="sync"?syncRetry(()=>run(bin("zcash-devtool"),["wallet","-w",path.join(STATE,"vault"),...args])):run(bin("zcash-devtool"),["wallet","-w",path.join(STATE,"vault"),...args]);
export const pczt=(...args:string[])=>run(bin("zcash-devtool"),["pczt","-w",path.join(STATE,"vault"),...args]);
export const inspect=(file:string)=>JSON.parse(run(path.join(ROOT,"settle/target/release/benzo-pczt"),["inspect",file,path.join(STATE,"ufvk.txt")]));
export const monetary=(id:string)=>JSON.parse(run(process.execPath,[path.join(ROOT,"settle/dist/plan.mjs"),id]));
export const notes=()=>run(path.join(ROOT,"scan/target/release/benzo-scan"),["scan","test",path.join(STATE,"vault")]).trim().split("\n").filter(Boolean).map(l=>JSON.parse(l));
export function prove(file:string,output:string):Promise<void> {
  return new Promise((resolve,reject)=> {
    const p=spawn(bin("zcash-devtool"),["pczt","-w",path.join(STATE,"vault"),"prove",file,"--output",output]);
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
