// What this browser holds: the bids it sealed (with their keys), the rounds it started (manage tokens) and its party
// keys for OTC and RFQ rounds. All of it stays in localStorage; nothing here is ever sent except public keys.
export type PartyKey = { private_hex: string; public_hex: string; rid: string; label: string };
export type Started = { rid: string; token: string; mode: string; lot: string; at: number };

const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));

export const parties = () => read<PartyKey[]>("benzo:parties", []);
export const addParty = (p: PartyKey) => write("benzo:parties", [...parties().filter((x) => x.rid !== p.rid), p]);
export const partyFor = (rid: string | null) => (rid ? parties().find((p) => p.rid === rid) ?? null : null);

export const started = () => read<Started[]>("benzo:started", []);
export const addStarted = (s: Started) => write("benzo:started", [s, ...started().filter((x) => x.rid !== s.rid)]);

// Every bid attempt this browser sealed. Each attempt is kept under its own key, benzo:bid:<round id>:<attempt>, and is
// never deleted once sealed (a deposit may already be on its way); benzo:bid-current:<round id> points at the attempt
// the bid page shows. Older single-key records (benzo:bid:<round id>) are read as one attempt.
export type Attempt = { step: "pay" | "track"; bid: any; txid?: string; savedKey?: boolean; at?: number; archived?: boolean };
const ROUND = (k: string) => k.slice(10, 74);
export const bids = () => Object.keys(localStorage).filter((k) => k.startsWith("benzo:bid:")).map((k) => ({ id: ROUND(k), key: k, ...read<Attempt>(k, {} as Attempt) }))
  .filter((b) => b.bid).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
export const attemptsFor = (id: string) => bids().filter((b) => b.id === id);
export const currentAttempt = (id: string) => { const k = localStorage.getItem(`benzo:bid-current:${id}`); const all = attemptsFor(id); return (k && all.find((b) => b.key === k)) || all.find((b) => !b.archived) || null; };
export const saveAttempt = (id: string, a: Attempt, key?: string) => {
  const k = key ?? `benzo:bid:${id}:${String(a.bid?.ciphertext_hash ?? Date.now()).slice(0, 12)}`;
  write(k, { at: Date.now(), ...a }); localStorage.setItem(`benzo:bid-current:${id}`, k); return k;
};
// "Place another bid": the attempt stays on record (archived); the page starts a fresh draft.
export const archiveCurrent = (id: string) => { const c = currentAttempt(id); if (c) write(c.key, { ...read<Attempt>(c.key, {} as Attempt), archived: true }); localStorage.removeItem(`benzo:bid-current:${id}`); };
