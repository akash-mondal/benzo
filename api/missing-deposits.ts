// Pure omission/refund boundary. A publishes chain-observed notes and timestamps for their mined heights.
// Height alone cannot establish a timestamp deadline; live block/transaction authentication belongs to A.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { jsonBytes, requireThat } from "../manifest/schema";
import { clientForMode } from "../clear/registry";
import { checkFrozen, type Frozen } from "../clear/merkle";
import type { PublicAuction } from "./public-auction";
export type MinedDeposit = { height:number; ciphertext_hash:string; note_id:string };
export type MinedDeposits = { version:1; auction_id:string; block_times:{height:number;time:number}[]; deposits:MinedDeposit[] };
function omissions(frozen:Frozen, auctionId:string, submitTime:number, C:string, list:MinedDeposits) {
  requireThat(list && Object.keys(list).sort().join(",") === "auction_id,block_times,deposits,version" &&
    list.version===1 && list.auction_id===auctionId && Array.isArray(list.deposits), "mined deposit list fields/binding");
  requireThat(Array.isArray(list.block_times), "mined block times");
  const times=new Map<number,number>();
  for(const b of list.block_times) {
    requireThat(b && Object.keys(b).sort().join(",") === "height,time" &&
      Number.isSafeInteger(b.height)&&b.height>0&&b.height<=0xffffffff&&Number.isSafeInteger(b.time)&&b.time>0 &&
      !times.has(b.height), "mined block time fields/duplicate height"); times.set(b.height,b.time);
  }
  const notes=new Set<string>(),frozenMatches=new Set<number>();
  const absent:MinedDeposit[]=[];
  for(const d of list.deposits) {
    requireThat(d && Object.keys(d).sort().join(",") === "ciphertext_hash,height,note_id" &&
      Number.isSafeInteger(d.height)&&d.height>0&&d.height<=0xffffffff&&/^[0-9a-f]{64}$/.test(d.ciphertext_hash)&&
      /^[0-9a-f]{64}:ironwood:(0|[1-9][0-9]*)$/.test(d.note_id) && Number(d.note_id.split(":")[2])<=65535, "mined deposit fields");
    requireThat(!notes.has(d.note_id), "duplicate mined note id");notes.add(d.note_id);
    requireThat(times.has(d.height), "missing mined block timestamp");
    const txid=d.note_id.split(":")[0];
    const leaf=frozen.leaves.find(l=>l.ciphertext_hash===d.ciphertext_hash && l.deposit.txid===txid && l.deposit.pool==="ironwood");
    if(leaf) {
      // An older Deposit lacks output_index: refuse ambiguous same-tx/same-ciphertext notes rather than
      // silently treating two distinct notes as one included leaf. A must retain the full NoteId when wiring.
      requireThat(!frozenMatches.has(leaf.leaf_index), "ambiguous frozen note identity");frozenMatches.add(leaf.leaf_index);
    } else if(times.get(d.height)!<submitTime) absent.push(d);
  }
  requireThat(list.block_times.every(b=>list.deposits.some(d=>d.height===b.height)), "unused mined block timestamp");
  return absent.sort((a,b)=>a.note_id.localeCompare(b.note_id)).map(d=>({auction_id:auctionId,...d,status:"refund_owed",refund_zats:C}));
}
export function missingDepositExceptions(pub:PublicAuction) {
  const file=path.join(pub.dir,"mined-deposits.json");if(!existsSync(file))return [];
  requireThat(pub.frozen,"mined deposits require frozen root");
  checkFrozen(pub.frozen!,pub.manifest.auction_id,pub.manifest_hash);
  return omissions(pub.frozen!,pub.manifest.auction_id,pub.manifest.T_submit,pub.manifest.C_zats,JSON.parse(readFileSync(file,"utf8")));
}
export function checkMissingDeposits(pub:PublicAuction): string|void {
  const expected=missingDepositExceptions(pub),file=path.join(pub.dir,"refund-exceptions.json");
  if(expected.length || existsSync(file)) {
    requireThat(existsSync(file), `missing refund exception queue: ${expected.map(d=>d.note_id+" exact-C "+d.refund_zats).join(", ")}`);
    const queue=JSON.parse(readFileSync(file,"utf8"));
    requireThat(jsonBytes(queue).equals(jsonBytes(expected)), "missing-bid refund exception queue differs (exact-C required)");
  }
  if(expected.length)return `${expected.length} not included; refund owed (exact C); chain observations supplied by publisher`;
}
export function missingBidProof(pub:PublicAuction, ciphertextHash:string, noteId?:string) {
  const matches=missingDepositExceptions(pub).filter(d=>d.ciphertext_hash===ciphertextHash && (!noteId||d.note_id===noteId));
  requireThat(matches.length===1,"missing bid not uniquely observed before T_submit");
  return {version:1,kind:"missing_bid_refund",included:false,message:"not included; refund owed",exception:matches[0],
    frozen:pub.frozen!,manifest:pub.manifestPacket,signer:pub.signer,
    mined_deposits:JSON.parse(readFileSync(path.join(pub.dir,"mined-deposits.json"),"utf8")) as MinedDeposits};
}
export type MissingBidProof=ReturnType<typeof missingBidProof>;
export function checkMissingBidProof(proof:MissingBidProof): void {
  requireThat(proof && Object.keys(proof).sort().join(",") === "exception,frozen,included,kind,manifest,message,mined_deposits,signer,version" &&
    proof.version===1&&proof.kind==="missing_bid_refund"&&proof.included===false&&proof.message==="not included; refund owed", "missing bid proof fields");
  const {manifest:m,manifest_hash}=clientForMode(proof.manifest,proof.signer) as {manifest:PublicAuction["manifest"];manifest_hash:string};
  checkFrozen(proof.frozen,m.auction_id,manifest_hash);
  const expected=omissions(proof.frozen,m.auction_id,m.T_submit,m.C_zats,proof.mined_deposits);
  requireThat(expected.some(e=>jsonBytes(e).equals(jsonBytes(proof.exception))),"missing bid proof exception differs");
}
