// Durable settlement obligations. Callers verify pinned private routing and chain observations before allocation.
import {DatabaseSync} from "node:sqlite";
import {mkdirSync,readFileSync,statSync} from "node:fs";
import path from "node:path";
import {hash,jsonBytes,requireThat} from "../manifest/schema";
import {isRefundRowParty} from "../clear/features";
import {isDepositParty} from "./deposits";
// Ruling R42 (F15): one note backs at most one REFUND row across all row classes (stray, late, excess,
// collision) — the ledger keys refunds by NOTE IDENTITY (`<txid>:<pool>:<action_index>`), so a reorg
// re-classification can never pay the same note twice. `Obligation.notes` names a row's backing notes (the
// excess row's in-window notes); a `balance-late:`/`deposit:` party IS its own note identity.
export type Obligation={party:string;kind:"payout"|"refund";amount_zats:string;notes?:string[]};
const NOTE_PARTY=/^(?:deposit|balance-late):([0-9a-f]{64}):(sapling|orchard|ironwood):(0|[1-9][0-9]*)$/;
// Ruling R44 (F18): a note-shaped party with an out-of-range action_index (or the legacy deposit identity)
// can never be keyed by note identity — it is an ERROR, never a silently unkeyed row (the pre-fix `[]`
// backing disabled the key and let one note refund twice).
const LEGACY_NOTE_PARTY=/^deposit:([0-9a-f]{64}):(0|[1-9][0-9]*)$/;
const isKeyedRefund=(party:string)=>isRefundRowParty(party)||isDepositParty(party);
// Ruling R46 (F23): "unpaid" = no money has moved for the row AND no signed batch commits it — nothing in a
// staged transaction can depend on its amount. Exactly these rows may be dropped or replaced at pin.
const unpaidRow=(r:{state:string;batch:number|null})=>r.batch===null&&!["paid","refunded"].includes(r.state);
const backingOf=(o:{party:string;notes?:string[]}):string[]=>{
  if(Array.isArray(o.notes))return o.notes;
  const m=NOTE_PARTY.exec(o.party);
  requireThat(!m || Number(m[3])<=65535,`unkeyable refund note identity ${o.party}; an unkeyable note is an ERROR`);
  return m?[`${m[1]}:${m[2]}:${m[3]}`]:[];
};
export type Row={party:string;kind:"payout"|"refund";amount_zats:string;batch:number|null;state:string;txid:string|null;output_index:number|null;pool:string|null}; // stored rows carry no derivation notes
export class Ledger {
  readonly db:DatabaseSync;
  constructor(state:string,readonly auction:string) {
    requireThat(/^[0-9a-f]{64}$/.test(auction),"settlement auction id");
    const dir=path.join(state,"settle",auction);mkdirSync(dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path.join(dir,"ledger.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS plan(hash TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS obligations(party TEXT PRIMARY KEY,kind TEXT NOT NULL,amount_zats TEXT NOT NULL,state TEXT NOT NULL,batch INTEGER,txid TEXT,output_index INTEGER,pool TEXT);
      CREATE TABLE IF NOT EXISTS batches(id INTEGER PRIMARY KEY,pczt_path TEXT,pczt_hash TEXT,txid TEXT UNIQUE,height INTEGER,state TEXT NOT NULL DEFAULT 'staged');
      CREATE TABLE IF NOT EXISTS refund_backing(note TEXT PRIMARY KEY,party TEXT NOT NULL);`);
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
      // Ruling R46 (F23), step 1: FIRST drop every unpaid row the plan no longer produces, releasing its backing
      // notes (no money moved for it and no signed batch holds it, so the note may back its own row again after
      // the reorg resolves); a kept (paid or in-flight) row keeps its notes forever — refunded once. Running this
      // before the per-row pass is what makes the F18 skip safe: an unpaid row that is about to vanish can never
      // subtract its amount from another row and take the value with it (probe p2a). Any other row vanishing
      // from the re-derivation is logged and the pinned row stands — never a refusal.
      const parties=new Set(plan.map(p=>p.party));
      for(const r of this.rows()) {
        if(parties.has(r.party))continue;
        // B46 (H15): a `reserve-return` row the fresh derivation no longer produces (its eligible notes moved,
        // or it is already paid) is history when money moved for it — kept quietly — and dropped when unpaid,
        // so a later derivation can replace it. Same monotone rule as the refund rows.
        if(isRefundRowParty(r.party)||r.party==="reserve-return") {
          if(unpaidRow(r)) {
            this.db.prepare("DELETE FROM obligations WHERE party=?").run(r.party);
            this.db.prepare("DELETE FROM refund_backing WHERE party=?").run(r.party);
          }
          else if(r.party!=="reserve-return")console.error(`WARN pinned refund row ${r.party} vanished from the re-derivation after payment; keeping it`);
          continue;
        }
        console.error(`WARN settlement obligation ${r.party} vanished from the re-derivation; the pinned row stands`);
      }
      // Ruling R46 (F23), step 3 inputs: `want` is the amount the rules say each fresh party's row must hold
      // after this pin; `history` names parties whose pinned row is history (money moved for it, a signed batch
      // commits it, or it is a payout row under Ruling R42 (F12)'s stands rule).
      const want=new Map<string,bigint>(),history=new Set<string>();
      const backingSet=(party:string)=>new Set((this.db.prepare("SELECT note FROM refund_backing WHERE party=?").all(party) as {note:string}[]).map(r=>r.note));
      const sameNotes=(party:string,notes:string[])=>{const a=backingSet(party),b=new Set(notes);return a.size===b.size&&[...b].every(n=>a.has(n))};
      for(const o of plan) {
        // Ruling R44 (F18): an unkeyable note is an ERROR — refuse note-shaped parties the note key cannot
        // hold (the scanner's u16 range; the legacy identity has no pool and was never keyable), and require
        // every keyed refund row to carry keyable note backing. Keying is never silently disabled.
        const shaped=NOTE_PARTY.exec(o.party) ?? LEGACY_NOTE_PARTY.exec(o.party);
        requireThat(!shaped || (NOTE_PARTY.test(o.party)&&Number(NOTE_PARTY.exec(o.party)![3])<=65535),`unkeyable refund note identity ${o.party}; an unkeyable note is an ERROR`);
        if(isKeyedRefund(o.party))requireThat(backingOf(o).length>0,`refund row ${o.party} carries no keyable note backing; an unkeyable note is an ERROR`);
        // Ruling R44 (F18): a backing note already taken by ANOTHER party's refund row is skipped per note,
        // never per row — the row is created over its FREE notes and the taken notes' refunded value leaves
        // its amount, so a multi-note excess row still refunds the remaining notes' value and conservation
        // stays zat-exact (row + settled + already-refunded = every zat received, once). The pre-fix skip
        // dropped the whole row and stranded the free notes' value.
        let o2=o;
        if(isKeyedRefund(o.party)) {
          const backing=backingOf(o);
          const ownerOf=(n:string)=>this.db.prepare("SELECT refund_backing.party AS party, obligations.amount_zats AS amount_zats FROM refund_backing JOIN obligations ON obligations.party=refund_backing.party WHERE refund_backing.note=?").get(n) as {party:string;amount_zats:string}|undefined;
          const owners=backing.map(ownerOf);
          const takenNotes=backing.filter((n,i)=>!!owners[i]&&owners[i]!.party!==o.party);
          if(takenNotes.length) {
            const free=backing.filter((n,i)=>!owners[i]||owners[i]!.party===o.party);
            // Ruling R46 (F23): when the fresh derivation produces no row, an UNPAID old row for the party is
            // released with it (the derivation no longer produces it); money moved or a batch commits, so the
            // row is history and stands.
            const skip=()=>{const old=this.rows().find(r=>r.party===o.party);
              if(old&&unpaidRow(old)&&old.kind==="refund"){this.db.prepare("DELETE FROM obligations WHERE party=?").run(o.party);this.db.prepare("DELETE FROM refund_backing WHERE party=?").run(o.party);want.set(o.party,0n)}
              else if(old)history.add(o.party);else want.set(o.party,0n)};
            if(!free.length){console.error(`WARN refund row ${o.party} not created: every backing note already backs a refund row (one note one refund; Ruling R42 F15)`);skip();continue;}
            // Ruling R46 (F23): only a row money has moved for represents refunded value — an UNPAID taking
            // row's amount is NEVER subtracted (its own row still owes that value; the pre-fix subtraction
            // destroyed it and then dropped the row — probes p2a/p2b). Ruling R45 (F22): where the subtraction
            // does run, its single-note assumption is an ASSERTION — a multi-note taking row is an ERROR,
            // never a wrong amount.
            const moved=[...new Set(takenNotes.map(n=>ownerOf(n)!.party))].filter(p=>{const r=this.rows().find(x=>x.party===p);return !!r&&["paid","refunded"].includes(r.state)});
            for(const p of moved)requireThat(Number((this.db.prepare("SELECT COUNT(*) AS c FROM refund_backing WHERE party=?").get(p) as {c:number}).c)===1,`multi-note taking row ${p} backs more than one note; the per-note skip subtracts a taking row's amount only when it backs exactly one note (a multi-note taking row is an ERROR)`);
            const takenValue=moved.reduce((s,p)=>s+BigInt(this.rows().find(r=>r.party===p)!.amount_zats),0n);
            const usable=BigInt(o.amount_zats)-takenValue;
            if(usable<=0n){console.error(`WARN refund row ${o.party} not created: its value is already refunded by the rows backing its taken notes (one note one refund; Ruling R42 F15)`);skip();continue;}
            if(takenValue>0n)console.error(`WARN refund row ${o.party}: note ${takenNotes[0]} already backs a refund row; skipping that note only (amount ${o.amount_zats} -> ${usable}; Ruling R44 F18)`);
            o2={...o,amount_zats:usable.toString(),notes:free};
          }
        }
        let old=this.rows().find(r=>r.party===o2.party);
        // Ruling R46 (F23), step 2: an unpaid REFUND row whose fresh derivation differs is REPLACED — deleted
        // and recreated, releasing its notes. "Rows never change" binds only rows money has moved for; a row a
        // signed batch commits is history too (its staged transaction pays its pinned amounts). A payout row
        // keeps Ruling R42 (F12)'s stands rule and its monotone exception growth.
        if(old&&unpaidRow(old)&&old.kind==="refund"&&(old.kind!==o2.kind||old.amount_zats!==o2.amount_zats||!sameNotes(o2.party,backingOf(o2)))) {
          this.db.prepare("DELETE FROM obligations WHERE party=?").run(o.party);
          this.db.prepare("DELETE FROM refund_backing WHERE party=?").run(o.party);
          old=undefined;
        }
        if(old){
          // Ruling R42 (F12): pin is monotone and total over chain-derived differences — a re-derivation that
          // differs from a pinned row is LOGGED and the PINNED ROW STANDS, and pin never throws for it (a
          // fresh-vs-pinned refusal is the F12 wedge). Unpaid refund rows never reach here (replaced above);
          // the only amount that ever moves is the pre-existing monotone growth of an unpaid EXCEPTION payout
          // (025c736; treasury growth is Mode B): amounts only grow there, and a row money has moved for never
          // changes.
          if(old.kind!==o2.kind)console.error(`WARN settlement obligation ${o.party} re-derived kind ${o2.kind} differs from pinned ${old.kind}; the pinned row stands`);
          if(old.amount_zats!==o2.amount_zats){
            if(o2.kind==="payout"&&old.state==="exception"&&BigInt(o2.amount_zats)>BigInt(old.amount_zats))this.db.prepare("UPDATE obligations SET amount_zats=? WHERE party=?").run(o2.amount_zats,o.party);
            else {
              console.error(`WARN settlement obligation ${o.party} re-derived ${o2.amount_zats} differs from pinned ${old.amount_zats}; the pinned row stands`);
              // A row whose re-derived amount disagrees with its pinned one is never payable at the stale
              // amount (every host derives the fresh amount and would refuse the candidate): it waits in the
              // exception queue — claimable like any parked row — until a derivation agrees again. Rows in
              // flight (allocated/staged) or settled are untouched history.
              if(["seen","eligible","exception"].includes(old.state))this.db.prepare("UPDATE obligations SET state='exception' WHERE party=?").run(o.party);
            }
          }
        }
        if(!old){
          // Ruling R42 (F15) + Ruling R44 (F18): a NEW refund row claims its backing notes by note identity —
          // the per-note skip and amount adjustment ran above, so every backing note here is free. A note that
          // already backs a different party's refund row never backs a second row. The pre-fix per-class key
          // (party uniqueness per class only) is the A20-F15 mutation.
          if(isKeyedRefund(o2.party)) {
            const backing=backingOf(o2);
            this.db.prepare("INSERT INTO obligations(party,kind,amount_zats,state) VALUES(?,?,?,?)").run(o2.party,o2.kind,o2.amount_zats,ready.has(o2.party)?"seen":"exception");
            for(const n of backing)this.db.prepare("INSERT OR IGNORE INTO refund_backing(note,party) VALUES(?,?)").run(n,o2.party);
          } else this.db.prepare("INSERT INTO obligations(party,kind,amount_zats,state) VALUES(?,?,?,?)").run(o2.party,o2.kind,o2.amount_zats,ready.has(o2.party)?"seen":"exception");
          want.set(o.party,BigInt(o2.amount_zats));
        }
        else {
          // A kept row stands (F12); its backing set only ever grows (INSERT OR IGNORE never steals a note
          // another row already backs) — the row's amount may already cover those notes' value.
          if(isKeyedRefund(o2.party))for(const n of backingOf(o2))this.db.prepare("INSERT OR IGNORE INTO refund_backing(note,party) VALUES(?,?)").run(n,o.party);
          if(["paid","refunded"].includes(old.state)||old.batch!==null||old.kind==="payout")history.add(o.party);
          else want.set(o.party,BigInt(o2.amount_zats));
        }
        if(old&&old.state==="exception"&&ready.has(o.party)) {
          // A row whose re-derived amount differs from its pinned one is never made payable at the stale
          // amount (every host derives the fresh amount and would refuse the candidate): it waits until a
          // derivation agrees with the pinned row again, and nothing else is held up by it.
          const now=this.rows().find(r=>r.party===o.party)!;
          if(now.amount_zats===o2.amount_zats)this.db.prepare("UPDATE obligations SET state='eligible' WHERE party=?").run(o.party);
          else console.error(`WARN settlement obligation ${o.party} pinned at ${now.amount_zats} but re-derived ${o2.amount_zats}; not payable until a derivation agrees`);
        }
      }
      // Ruling R46 (F23), step 3: conservation is asserted at pin — rows + settled + refunded = received. The
      // fresh derivation is exactly "received − settled" (every plan, every signer host and the verify-side
      // replays re-derive it through the one shared rule, and R41's conservation property keeps it zat-exact),
      // and rows money has moved for (or a signed batch commits) are history at their pinned amounts. After
      // reconciliation the ledger must hold exactly the fresh assignments, once: no reorg re-classification may
      // destroy value (probes p2a/p2b: a taken row's amount subtracted and that row then dropped) or duplicate
      // it (probe p3). This is a code-consistency assertion, defence in depth like R45 (F22)'s: chain input can
      // never reach it, so it is an ERROR and never a wedge (R38).
      for(const o of plan) {
        if(history.has(o.party))continue;
        const row=this.rows().find(r=>r.party===o.party),wantAmt=want.get(o.party)??0n;
        requireThat(row===undefined?wantAmt===0n:BigInt(row.amount_zats)===wantAmt,
          `conservation at pin: rows + settled + refunded = received (${o.party} derived ${wantAmt} vs ledger ${row?row.amount_zats:"no row"})`);
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
