// R26 item 1: the one deposit-note identity rule. A note is identified by its output position —
// `deposit:<txid>:<pool>:<action_index>` with `action_index` the output/action index benzo-scan emits —
// never by its address's diversifier index: one transaction can carry two outputs to the same deposit
// address, and each note is its own refund obligation. Every plan, claim, verify and evidence path derives
// and parses deposit parties through these helpers. A zero-value note is never an obligation: it is
// ignored here and counted in verify's accounting (`settlement.ignored`).
export type DepositNote = {
  txid: string;
  pool: string;
  action_index: number;
  address: string;
  value_zats: number;
  memo_hex: string;
  height: number | null;
  spent_in_txid: string | null;
};

// Strict party shape: 64-hex txid, one of the three shielded pool names, and an output/action index in
// the scanner's u16 range (decimal, no leading zeros).
const PARTY = /^deposit:([0-9a-f]{64}):(sapling|orchard|ironwood):(0|[1-9][0-9]*)$/;

export function isDepositParty(party: string): boolean {
  const m = PARTY.exec(party);
  return !!m && Number(m[3]) <= 65535;
}

// Historical published rows (evidence from Phases 2–5 before R26 item 1) name a note by its
// address's diversifier index, `deposit:<txid>:<diversifier_index>`. Those directories are immutable,
// so every verifier-side ACCEPTANCE of a published party takes either identity. Writers never emit
// this one; the strict identity above stays the only one the product writes.
const LEGACY_PARTY = /^deposit:([0-9a-f]{64}):(0|[1-9][0-9]*)$/;

export function isAnyDepositParty(party: string): boolean {
  return isDepositParty(party) || !!LEGACY_PARTY.exec(party);
}

export function depositParty(note: { txid: string; pool: string; action_index: number }): string {
  const party = `deposit:${note.txid}:${note.pool}:${note.action_index}`;
  if (!isDepositParty(party)) throw new Error(`refused: scanned note is not a deposit identity (${party})`);
  return party;
}

// The exact note a deposit party names, or undefined when none does.
export function partyNote<T extends { txid: string; pool: string; action_index: number }>(notes: T[], party: string): T | undefined {
  const m = PARTY.exec(party);
  return m && Number(m[3]) <= 65535
    ? notes.find(n => n.txid === m[1] && String(n.pool) === m[2] && String(n.action_index) === m[3])
    : undefined;
}

// Zero-value notes are never obligations (rows or exception rows): they are ignored and counted.
export function refundable<T extends DepositNote>(notes: T[]): { payable: T[]; ignored: { party: string; amount_zats: string }[] } {
  const payable: T[] = [], ignored: { party: string; amount_zats: string }[] = [];
  for (const n of notes) {
    if (n.value_zats > 0) payable.push(n);
    else ignored.push({ party: depositParty(n), amount_zats: "0" });
  }
  return { payable, ignored };
}

// The plan's stray rule, shared with the witnesses' strays statement: a deposit-address note that is not
// one of the frozen leaves' deposits (or any of them when nothing was frozen).
export function strayNotes<T extends { txid: string; address: string }>(
  notes: T[],
  depositAddresses: string[],
  frozen: { leaves: { deposit: { txid: string; address: string } }[] } | null | undefined,
): T[] {
  return notes.filter(n =>
    depositAddresses.includes(n.address) &&
    !(frozen?.leaves ?? []).some(l => l.deposit.txid === n.txid && l.deposit.address === n.address));
}
