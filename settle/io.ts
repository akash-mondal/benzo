import {execFileSync,spawn,spawnSync} from "node:child_process";
import {appendFileSync,readFileSync} from "node:fs";
import path from "node:path";
export const ROOT=execFileSync("git",["rev-parse","--show-toplevel"]).toString().trim();
for(const l of readFileSync(path.join(ROOT,".env"),"utf8").split("\n")) {const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2]}
export const STATE=path.resolve(ROOT,process.env.BNZ_STATE_DIR!),bin=(n:string)=>path.join(STATE,"bin",n);
export const env=(n:string)=>{const v=process.env[n];if(!v)throw Error(`missing ${n}`);return v};
export function run(cmd:string,args:string[],input?:string|Buffer):string {
  const p=spawnSync(cmd,args,{input,encoding:"utf8",maxBuffer:64<<20});
  appendFileSync(path.join(STATE,"run","settle-cli.log"),`\n${path.basename(cmd)}\n${p.stdout??""}${p.stderr??""}`);
  if(p.error)throw p.error;if(p.status!==0)throw Error(`${path.basename(cmd)} exited ${p.status}: ${(p.stderr||p.stdout).trim().slice(-300)}`);return p.stdout;
}
export const wallet=(...args:string[])=>run(bin("zcash-devtool"),["wallet","-w",path.join(STATE,"vault"),...args]);
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
export function chainTx(txid:string,endpoint:string) {
  const hash=Buffer.from(txid,"hex").reverse().toString("base64");
  return JSON.parse(run(bin("grpcurl"),["-import-path",path.join(STATE,"proto"),"-proto","service.proto","-d",JSON.stringify({hash}),endpoint,"cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTransaction"]));
}
