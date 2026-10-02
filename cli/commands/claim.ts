import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireThat } from "../../manifest/schema";
import { ownerPublic } from "../../envelope/index";
import { checkPublicAuction, loadCompletePublicAuction } from "../../api/public-auction";
import { checkDeliveryClaim, deliveryClaim } from "../../adapters/zilkroad";
export const noun="claim", verb="";
export const help="benzo claim --dir PUBLIC --ciphertext-hash HEX [--receipt FILE --statement FILE] [--owner-key-stdin | --check CLAIM] — owner-signed offline delivery claim";
export async function run(argv:string[]):Promise<number> {
  let dir="",ct="",receiptFile="",statementFile="",check="",stdin=false;
  for(let i=0;i<argv.length;i++) {
    if(argv[i]==="--dir")dir=argv[++i]??"";
    else if(argv[i]==="--ciphertext-hash")ct=argv[++i]??"";
    else if(argv[i]==="--receipt")receiptFile=argv[++i]??"";
    else if(argv[i]==="--statement")statementFile=argv[++i]??"";
    else if(argv[i]==="--check")check=argv[++i]??"";
    else if(argv[i]==="--owner-key-stdin")stdin=true;
    else {process.stderr.write(`ERROR claim usage: ${help}\n`);return 2;}
  }
  try {
    requireThat(dir && /^[0-9a-f]{64}$/.test(ct) && !(check && stdin),"claim arguments");
    const pub=loadCompletePublicAuction(dir);
    const root=execFileSync("git",["rev-parse","--show-toplevel"],{encoding:"utf8"}).trim();
    const bid=path.join(path.resolve(root,process.env.BNZ_STATE_DIR||".benzo"),"bids",pub.manifest.auction_id,ct);
    const receipt=JSON.parse(readFileSync(receiptFile||bid+".receipt.json","utf8")),statement=JSON.parse(readFileSync(statementFile||bid+".statement.json","utf8"));
    const failures=checkPublicAuction(pub).filter(c=>c.error); requireThat(!failures.length,`claim public verification: ${failures.map(c=>c.id+" "+c.error).join("; ")}`);
    if(check) {checkDeliveryClaim(pub,ct,receipt,statement,JSON.parse(readFileSync(check,"utf8")));process.stdout.write("OK delivery claim\n");return 0;}
    const saved=JSON.parse(readFileSync(stdin?0:bid+".json","utf8"));
    const owner={private_hex:saved.owner_private_hex,public_hex:ownerPublic(saved.owner_private_hex)};
    process.stdout.write(JSON.stringify(deliveryClaim(pub,ct,receipt,statement,owner),null,2)+"\n");return 0;
  }catch(e){process.stderr.write(`ERROR claim ${(e as Error).message}\n`);return 1;}
}
