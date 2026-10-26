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

// Every bid this browser sealed, by round (BidView saves each under benzo:bid:<auction id>).
export const bids = () => Object.keys(localStorage).filter((k) => k.startsWith("benzo:bid:")).map((k) => ({ id: k.slice(10), ...read<any>(k, {}) }));
