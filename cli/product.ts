// Track A product state and CLI boundaries. Auction and settlement algorithms stay in their existing entry points.
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createPublicKey,generateKeyPairSync} from 'node:crypto';
import path from 'node:path';
import http from 'node:http';
import {chromium} from '@playwright/test';
import {client,hash,jsonBytes,requireThat,signRecord,validateManifest,QUICKNET} from '../manifest/schema';
import {ROOT,STATE,bin,run as execute,inspect,chainTx,notes} from '../settle/io';
export const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const save=(p:string,v:any)=>{mkdirSync(path.dirname(p),{recursive:true,mode:0o700});writeFileSync(p+'.new',jsonBytes(v),{mode:0o600});renameSync(p+'.new',p)};
const key=path.join(STATE,'auction/manifest-signing.pem');
const config=(id:string)=>path.join(STATE,'product',id+'.json');
const ledger=(id:string)=>path.join(STATE,'auction',id+'.json');
const draft=(id:string)=>path.join(STATE,'product',id+'.draft.json');
function options(args:string[]) {
  const result:Record<string,string>={};
  for(let i=0;i<args.length;i++){requireThat(/^--[a-z-]+$/.test(args[i]),'expected named option');const k=args[i].slice(2);requireThat(!result[k],'duplicate option');result[k]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:'true'}return result;
}
const input=(o:Record<string,string>)=>read(o.file??'/dev/stdin');
const ac=(verb:string,id:string,v:any={})=> {const p=spawnSync(process.execPath,[path.join(ROOT,'clear/dist/auction.mjs'),verb,id],{input:JSON.stringify(v),encoding:'utf8',maxBuffer:64<<20});if(p.error)throw p.error;requireThat(p.status===0,p.stderr.trim().slice(-300));return JSON.parse(p.stdout)};
const sc=(verb:string,id:string,args:string[]=[],v:any={})=>execute(process.execPath,[path.join(ROOT,'settle/dist/cli.mjs'),verb,id,...args],JSON.stringify(v));
function privatePath(p:string) {const resolved=path.resolve(p);requireThat(resolved.startsWith(STATE+path.sep),'private file must live under BNZ_STATE_DIR');return resolved}
export function publish(id:string) {
  const a=read(ledger(id)),cfg=read(config(id)),dir=path.resolve(cfg.public_dir);
  const doc:any={version:1,auction_id:id,signer:a.signer,manifest:a.manifest,state:a.state,receipts:a.receipts};
  if(a.frozen)doc.frozen=a.frozen;if(a.result)doc.result=a.result;if(a.opened)doc.opened=a.opened;if(a.beacon)doc.beacon=a.beacon;
  const sd=path.join(STATE,'settle',id),summary=path.join(sd,'summary.json');
  if(existsSync(summary)) {
    const s=read(summary);
    doc.settlement={rows:s.rows,receipts:read(path.join(sd,'receipts.json')),offline_signer:s.offline_signer,batches:s.batches.map((b:any)=>{
      const base=path.join(sd,`batch-${b.id}`),i=existsSync(base+'.inspect.json')?read(base+'.inspect.json'):null;
      return {...b,state:b.state,inspect:i?{...i,outputs:i.outputs.map(({recipient,...o}:any)=>({...o,matches_pinned_routing:true}))}:null,signing:existsSync(base+'.signatures.json')?read(base+'.signatures.json'):null};
    })};
  }
  requireThat(dir.startsWith(ROOT+path.sep)&&!dir.startsWith(STATE+path.sep)&&dir!==STATE,'public directory must be in repository outside private state');
  save(path.join(dir,'manifest.json'),doc.manifest);if(doc.frozen)save(path.join(dir,'frozen.json'),doc.frozen);if(doc.result)save(path.join(dir,'result.json'),doc.result);
  save(path.join(dir,'signer.json'),{signer:doc.signer});save(path.join(dir,'receipts.json'),doc.receipts);if(doc.opened)save(path.join(dir,'opened.json'),doc.opened);if(doc.beacon)save(path.join(dir,'beacon.json'),doc.beacon);if(doc.settlement)save(path.join(dir,'summary.json'),doc.settlement);
  save(path.join(dir,'auction.json'),doc);return doc;
}
export async function runCommand(command:string,args:string[]) {
  const o=options(args),id=o.id;
  if(id)requireThat(/^[0-9a-f]{64}$/.test(id),'auction id');
  if(command==='auction create') {
    const m=input(o);requireThat(m.refund?.invalid==="full_C","invalid refund policy must say full_C");validateManifest(m);requireThat(!existsSync(draft(m.auction_id))&&!existsSync(ledger(m.auction_id)),'auction already exists');
    save(draft(m.auction_id),{manifest:m,state:'DRAFT'});return {auction_id:m.auction_id,state:'DRAFT',manifest:m};
  }
  if(command==='auction sign') {
    requireThat(id,'--id required');const d=read(draft(id));
    const k=o.key?privatePath(o.key):key;
    if(!existsSync(k)){mkdirSync(path.dirname(k),{recursive:true,mode:0o700});writeFileSync(k,generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600})}
    requireThat(path.resolve(k)===key,'auction receipt signer must match the local manifest key');
    d.signed=signRecord(d.manifest,readFileSync(k,'utf8'));save(draft(id),d);return d.signed;
  }
  if(command==='auction publish') {
    requireThat(id&&o.dir&&o.config,'--id --dir --config required');
    const d=read(draft(id));requireThat(d.signed,'sign the manifest first');
    const cfg=read(privatePath(o.config));requireThat(cfg.settlement&&cfg.routing,'operator config needs settlement and private routing');
    requireThat(Number.isInteger(cfg.settlement.batch_cap)&&cfg.settlement.batch_cap>=1&&cfg.settlement.batch_cap<=50&&Number.isInteger(cfg.settlement.pczt_expiry_blocks)&&cfg.settlement.pczt_expiry_blocks>=1&&cfg.settlement.pczt_expiry_blocks<=10000,'batch cap/expiry config');
    save(config(id),{...cfg,public_dir:path.resolve(o.dir)});
    ac('init',id,{manifest:d.signed,signer:d.signed.signer});sc('init',id,[],cfg.routing);return publish(id);
  }
  if(command==='auction status') {
    requireThat(id,'--id required');if(!existsSync(ledger(id)))return {auction_id:id,state:read(draft(id)).state};
    const a=read(ledger(id)),m=client(a.manifest,a.signer).manifest;
    const chainTip=Number(JSON.parse(execute(bin('grpcurl'),['-import-path',path.join(STATE,'proto'),'-proto','service.proto',process.env.BNZ_LWD_URL!,'cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLatestBlock'])).height);
    const response=await fetch(process.env.BNZ_DRAND_URLS!.split(',')[0]+'/'+m.drand.chain_hash+'/public/latest');requireThat(response.ok,'drand status unavailable');const round=(await response.json()).round;
    requireThat(Number.isSafeInteger(chainTip)&&chainTip>0&&Number.isSafeInteger(round)&&round>0,'status tip/round');return {auction_id:id,state:a.state,accepted:a.leaves.length,manifest_hash:a.manifest.sha256,chain_tip:chainTip,drand_round:round};
  }
  if(command==='bid prepare'||command==='bid seal') {
    requireThat(o.manifest&&o.signer,'--manifest --signer required');const packet=read(o.manifest),prepared=client(packet,o.signer),m=prepared.manifest;
    if(command==='bid prepare')return prepared;
    const bid=input(o);requireThat(m.deposit_addresses.includes(bid.address),'unlisted per-bid address');
    requireThat(Date.now()/1000<m.T_submit,'submission deadline');
    const server=http.createServer((req,res)=>{const n=req.url==='/main.js'?'main.js':'index.html';res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':'text/html');res.end(readFileSync(path.join(ROOT,'seal/dist',n)))});
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
    try {
      const page=await browser.newPage();await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
      const fields={opening:new Date((QUICKNET.genesis+(m.drand.R-1)*QUICKNET.period)*1000).toISOString(),auction:m.auction_id,price:bid.price_zats,quantity:String(bid.quantity),collateral:m.C_zats,address:bid.address};
      await page.route('**/*',route=>route.abort());
      for(const [k,v] of Object.entries(fields))await page.locator('#'+k).fill(v);
      await page.locator('#seal').click();await page.waitForFunction(()=>document.getElementById('envelope')!.textContent||document.getElementById('error')!.textContent);
      const error=await page.locator('#error').innerText();requireThat(!error,error);
      return {auction_id:m.auction_id,envelope_hex:await page.locator('#envelope').innerText(),uri:await page.locator('#uri').innerText(),round:Number(await page.locator('#round').innerText())};
    } finally {await browser.close();server.close()}
  }
  if(command==='bid deposit') {
    requireThat(id,'--id required');const bid=input(o),a=read(ledger(id)),m=client(a.manifest,a.signer).manifest;
    if(o.pay==='true') {
      requireThat(Date.now()/1000<m.T_submit,'submission deadline');
      const bids=bid.bids??[bid],params=new URLSearchParams();
      for(const [index,b] of bids.entries()) {
        const uri=new URL(b.uri);requireThat(uri.pathname===b.address&&m.deposit_addresses.includes(b.address)&&uri.searchParams.get('memo')===Buffer.from(b.envelope_hex,'hex').toString('base64url'),'deposit URI binding');
        requireThat(Number(uri.searchParams.get('amount'))===Number(m.C_zats)/1e8,'deposit amount differs from C');
        const suffix=index?`.${index}`:'';params.set('address'+suffix,b.address);params.set('amount'+suffix,uri.searchParams.get('amount')!);params.set('memo'+suffix,uri.searchParams.get('memo')!);
      }
      const reserve=bid.reserve;
      if(reserve) {
        requireThat(reserve.address===read(config(id)).routing.fee_reserve_ua&&/^[1-9][0-9]*$/.test(reserve.amount_zats),'reserve must match operator config');
        const suffix='.'+bids.length;params.set('address'+suffix,reserve.address);params.set('amount'+suffix,(Number(reserve.amount_zats)/1e8).toFixed(8));
      }
      execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'sync','-s',process.env.BNZ_LWD_URL!]);
      const balance=JSON.parse(execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'balance','--json']));
      const available=balance.sapling_spendable+balance.orchard_spendable+balance.ironwood_spendable,c=Number(m.C_zats);
      requireThat(available-c*bids.length-Number(reserve?.amount_zats??0)-5000*(bids.length+2)>=3*c+40000,'bidder floor; Needs user funds');
      const output=execute(bin('zcash-devtool'),['wallet','-w',path.join(STATE,'bidder'),'pay','-i',path.join(STATE,'bidder.age'),'--disable-confirmation','-s',process.env.BNZ_LWD_URL!,'--payment-uri','zcash:?'+params]);
      const txid=output.match(/^[0-9a-f]{64}$/gm)?.at(-1);requireThat(txid,'payment produced no txid');
      return {txid,C_zats:m.C_zats,deposits:bids.length,state:'broadcast'};
    }
    const admitted=ac('admit',id,bid);publish(id);return {...admitted,C_zats:m.C_zats};
  }
  if(['freeze','open','clear'].includes(command)) {requireThat(id,'--id required');const result=ac(command,id);publish(id);return command==='open'?{auction_id:id,state:'OPENED',opened:result.opened.length}:result}
  if(command==='settle'||command==='cancel'||command==='sign join') {
    requireThat(id,'--id required');
    if(command==='sign join'&&o.name) {
      requireThat(['alice','bob','carol'].includes(o.name)&&/^[0-9a-f]{64}$/.test(o.randomizer),'signer/randomizer');
      requireThat(o.batch&&o.candidate&&o.randomizer&&o.sighash,'--batch --candidate --randomizer --sighash required');
      const candidate=privatePath(o.candidate),approved=read(path.join(STATE,'settle',id,'approvals',o.name+'-'+o.randomizer+'.json'));
      requireThat(approved.participant===o.name&&approved.randomizer===o.randomizer&&approved.sighash===o.sighash&&approved.pczt_hash===hash(readFileSync(candidate))&&approved.manifest_hash===read(ledger(id)).manifest.sha256,'inspect approval differs from join candidate');
      await new Promise<void>((resolve,reject)=>{const p=spawn(bin('frost-client'),['participant','-c',path.join(STATE,'frost',o.name+'.toml'),'-s',process.env.BNZ_FROSTD_ADDR!,'-g',readFileSync(path.join(STATE,'group-key.txt'),'utf8').trim()],{stdio:'inherit',env:{...process.env,SSL_CERT_FILE:path.join(STATE,'tls/rootCA.pem')}});p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(`participant exit ${c}`)))});return;
    }
    if(command==='cancel'){ac('cancel',id);publish(id)}
    const p=spawn(process.execPath,[path.join(ROOT,'settle/dist/cli.mjs'),'run',id],{stdio:'inherit'});
    await new Promise<void>((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(Error(`settle exit ${c}`)))});
    const a=read(ledger(id)),status=JSON.parse(sc('status',id));a.state=status.rows.some((r:any)=>r.state==='exception')?'SETTLING':command==='cancel'?'CANCELLED':'SETTLED';save(ledger(id),a);return publish(id);
  }
  if(command==='sign inspect') {requireThat(['alice','bob','carol'].includes(o.name)&&(!o.randomizer||/^[0-9a-f]{64}$/.test(o.randomizer)),'signer/randomizer');requireThat(id&&o.batch&&o.candidate&&o.name,'--id --batch --candidate --name required');const approved=JSON.parse(sc('check',id,[o.batch,privatePath(o.candidate),o.name,o.randomizer??'',o.sighash??'']));if(o.randomizer)save(path.join(STATE,'settle',id,'approvals',o.name+'-'+o.randomizer+'.json'),approved);return approved}
  throw Error('unknown Track A command');
}
