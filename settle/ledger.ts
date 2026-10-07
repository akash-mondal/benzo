// Durable settlement obligations. Callers verify pinned private routing and chain observations before allocation.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync,readFileSync,statSync} from "node:fs";
import path from "node:path";
import {hash,jsonBytes,requireThat} from "../manifest/schema";
import {isRefundRowParty} from "../clear/features";
export type Obligation={party:string;kind:"payout"|"refund";amount_zats:string};
export type Row=Obligation & {batch:number|null;state:string;txid:string|null;output_index:number|null;pool:string|null};
export class Ledger {
  readonly db:DatabaseSync;
  constructor(state:string,readonly auction:string) {
    requireThat(/^[0-9a-f]{64}$/.test(auction),"settlement auction id");
    const dir=path.join(state,"settle",auction);mkdirSync(dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(dir,"ledger.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS plan(hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS obligations(party TEXT PRIMARY KEY,kind TEXT NOT NULL,amount_zats TEXT NOT NULL,state TEXT NOT NULL,batch INTEGER,txid TEXT,output_index INTEGER,pool TEXT);
      CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY,pczt_path TEXT,pczt_hash TEXT,txid TEXT UNIQUE,height INTEGER,state TEXT NOT NULL DEFAULT 'staged');`);
    if(!this.db.prepare("PRAGMA table_info(batches)").all().some(c=>c.name==="state"))this.db.exec("ALTER TABLE batches ADD COLUMN state TEXT NOT NULL DEFAULT 'staged'");
  }
  private atomic<T>(fn:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE");
    try {const result=fn();this.db.exec("COMMIT");return result} catch(e) {this.db.exec("ROLLBACK");throw e}
  }
  pin(plan:Obligation[],exceptions:Obligation[]=[]) {
    const ready=new Set(plan.map(o=>o.party));plan=[...plan,...exceptions].sort((a,b)=>a.party.localeCompare(b.party));
    requireThat(plan.length>0 && new Set(plan.map(o=>o.party)).size===plan.length,"unique settlement parties");
    requireThat(plan.every(o=>["payout","refund"].includes(o.kind)&&/^[1-9][0-9]*$/.test(o.amount_zats)&&BigInt(o.amount_zats)<=2_100_000_000_000_000n),"settlement obligation amounts");
    const digest=hash(jsonBytes(plan));
    this.atomic(()=> {
      for(const o of plan) {
        const old=this.rows().find(r=>r.party===o.party);
        if(old){
          requireThat(old.kind===o.kind,"settlement obligation changed on resume");
          if(old.amount_zats!==o.amount_zats){
            // Ruling R40 item 2 (F2): REFUND rows never change — each out-of-window note is its own immutable
            // `balance-late:` row and a newly seen note ADDS a new row, so no chain state a third party can
            // create may make settlement refuse. The 025c736 growth allowance is withdrawn for refunds; an
            // unpaid EXCEPTION payout may still grow (a row money has moved for never changes).
            requireThat(o.kind==="payout"&&old.state==="exception"&&BigInt(o.amount_zats)>BigInt(old.amount_zats),"settlement obligation changed on resume");
            this.db.prepare("UPDATE obligations SET amount_zats=? WHERE party=?").run(o.amount_zats,o.party);
          }
        }
        if(!old)this.db.prepare("INSERT INTO obligations(party,kind,amount_zats,state) VALUES(?,?,?,?)").run(o.party,o.kind,o.amount_zats,ready.has(o.party)?"seen":"exception");
        else if(old.state==="exception"&&ready.has(o.party))this.db.prepare("UPDATE obligations SET state='eligible' WHERE party=?").run(o.party);
      }
      // Ruling R40 item 2 (F2) + Ruling R41 item 4 (F10): refund rows never change and a newly seen late note
      // ADDS its own row, so no chain state a third party can create may make settlement refuse. A
      // `balance-late:`/`balance-excess:` row the plan no longer produces (its note reorged away or
      // reclassified) is dropped while no money has moved for it, and kept as its own history otherwise; any
      // other row vanishing is still a refusal.
      const parties=new Set(plan.map(p=>p.party));
      for(const r of this.rows()) {
        if(parties.has(r.party))continue;
        if(isRefundRowParty(r.party)) {
          if(["exception","seen","eligible"].includes(r.state))this.db.prepare("DELETE FROM obligations WHERE party=?").run(r.party);
          continue;
        }
        requireThat(false,"settlement obligation disappeared on resume");
      }
      this.db.exec("DELETE FROM plan");this.db.prepare("INSERT INTO plan VALUES(?)").run(digest);
    });
    return digest;
  }
  eligible() {
    // A caller supplies fresh, verified confirmations before invoking this transition.
    this.atomic(()=> {
      this.db.exec("UPDATE obligations SET state='confirmed' WHERE state='seen'");
      this.db.exec("UPDATE obligations SET state='eligible' WHERE state='confirmed'");
    });
  }
  allocate(cap=13):{id:number;outputs:Row[]}|null {
    return this.atomic(()=> {
      const pending=this.db.prepare("SELECT id FROM batches WHERE height IS NULL AND state!='exception' ORDER BY id LIMIT 1").get() as {id:number}|undefined;
      if(pending)return {id:pending.id,outputs:this.rows().filter(o=>o.batch===pending.id&&o.state==="allocated")};
      const outputs=this.db.prepare("SELECT * FROM obligations WHERE state='eligible' ORDER BY party LIMIT ?").all(cap) as Row[];
      if(!outputs.length)return null;
      const id=Number(this.db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM batches").get()!.id);
      this.db.prepare("INSERT INTO batches(id) VALUES(?)").run(id);
      for(const o of outputs)this.db.prepare("UPDATE obligations SET state='allocated',batch=? WHERE party=? AND state='eligible'").run(id,o.party);
      return {id,outputs:this.rows().filter(o=>o.batch===id)};
    });
  }
  stage(id:number,file:string,txid:string) {
    requireThat(/^[0-9a-f]{64}$/.test(txid)&&statSync(file).size>0,"signed transaction staging");
    const digest=hash(readFileSync(file));
    this.atomic(()=> {
      const old=this.batch(id);requireThat(old,"unknown settlement batch");
      requireThat(!old!.txid || old!.txid===txid && old!.pczt_hash===digest,"different transaction on resume");
      this.db.prepare("UPDATE batches SET pczt_path=?,pczt_hash=?,txid=? WHERE id=?").run(file,digest,txid,id);
    });
  }
  expire(id:number) {
    this.atomic(()=> {
      requireThat(!this.batch(id)?.height,"cannot expire a mined batch");
      this.db.prepare("UPDATE obligations SET state='exception',batch=NULL WHERE batch=? AND state='allocated'").run(id);
      this.db.prepare("UPDATE batches SET state='exception' WHERE id=?").run(id);
    });
  }
  confirm(id:number,txid:string,height:number,outputs:{party:string;amount_zats:string;index:number;pool:string}[]) {
    requireThat(Number.isInteger(height)&&height>0,"settlement is not mined");
    this.atomic(()=> {
      const batch=this.batch(id);requireThat(batch?.txid===txid,"confirmed transaction differs from staged transaction");
      const rows=this.rows().filter(o=>o.batch===id);
      requireThat(rows.length===outputs.length&&new Set(outputs.map(o=>`${o.pool}:${o.index}`)).size===outputs.length,"one receipt per allocated output");
      for(const r of rows) {
        const o=outputs.find(o=>o.party===r.party);requireThat(o?.amount_zats===r.amount_zats&&Number.isInteger(o.index)&&o.index>=0,"mined output differs from obligation");
        this.db.prepare("UPDATE obligations SET state=?,txid=?,output_index=?,pool=? WHERE party=?").run(r.kind==="refund"?"refunded":"paid",txid,o!.index,o!.pool,r.party);
      }
      this.db.prepare("UPDATE batches SET height=?,state='mined' WHERE id=?").run(height,id);
    });
  }
  rows() {return this.db.prepare("SELECT * FROM obligations ORDER BY party").all() as Row[]}
  batch(id:number) {return this.db.prepare("SELECT * FROM batches WHERE id=?").get(id) as {id:number;pczt_path:string|null;pczt_hash:string|null;txid:string|null;height:number|null;state:string}|undefined}
  receipts() {return this.rows().filter(o=>["paid","refunded"].includes(o.state)).map(o=>({auction_id:this.auction,party:o.party,txid:o.txid,pool:o.pool,output_index:o.output_index,amount_zats:o.amount_zats}))}
  close() {this.db.close()}
}
