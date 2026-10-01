// Durable settlement obligations. Callers verify pinned private routing and chain observations before allocation.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync,readFileSync,statSync} from "node:fs";
import path from "node:path";
import {hash,jsonBytes,requireThat} from "../manifest/schema";
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
      CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY,pczt_path TEXT,pczt_hash TEXT,txid TEXT UNIQUE,height INTEGER);`);
  }
  private atomic<T>(fn:()=>T):T {
    this.db.exec("BEGIN IMMEDIATE");
    try {const result=fn();this.db.exec("COMMIT");return result} catch(e) {this.db.exec("ROLLBACK");throw e}
  }
  pin(plan:Obligation[]) {
    requireThat(plan.length>0 && new Set(plan.map(o=>o.party)).size===plan.length,"unique settlement parties");
    requireThat(plan.every(o=>["payout","refund"].includes(o.kind)&&/^[1-9][0-9]*$/.test(o.amount_zats)&&BigInt(o.amount_zats)<=2_100_000_000_000_000n),"settlement obligation amounts");
    const digest=hash(jsonBytes(plan));
    this.atomic(()=> {
      const previous=this.db.prepare("SELECT hash FROM plan").get() as {hash:string}|undefined;
      if(previous) {requireThat(previous.hash===digest,"settlement plan changed on resume");return}
      this.db.prepare("INSERT INTO plan VALUES(?)").run(digest);
      for(const o of plan)this.db.prepare("INSERT INTO obligations(party,kind,amount_zats,state) VALUES(?,?,?,'seen')").run(o.party,o.kind,o.amount_zats);
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
  allocate():{id:number;outputs:Row[]}|null {
    return this.atomic(()=> {
      const pending=this.db.prepare("SELECT id FROM batches WHERE height IS NULL ORDER BY id LIMIT 1").get() as {id:number}|undefined;
      if(pending)return {id:pending.id,outputs:this.rows().filter(o=>o.batch===pending.id&&o.state==="allocated")};
      const outputs=this.db.prepare("SELECT * FROM obligations WHERE state='eligible' ORDER BY party LIMIT 50").all() as Row[];
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
      this.db.prepare("UPDATE batches SET height=? WHERE id=?").run(height,id);
    });
  }
  rows() {return this.db.prepare("SELECT * FROM obligations ORDER BY party").all() as Row[]}
  batch(id:number) {return this.db.prepare("SELECT * FROM batches WHERE id=?").get(id) as {id:number;pczt_path:string|null;pczt_hash:string|null;txid:string|null;height:number|null}|undefined}
  receipts() {return this.rows().filter(o=>["paid","refunded"].includes(o.state)).map(o=>({auction_id:this.auction,party:o.party,txid:o.txid,pool:o.pool,output_index:o.output_index,amount_zats:o.amount_zats}))}
  close() {this.db.close()}
}
