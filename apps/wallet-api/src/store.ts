/**
 * Consumer-side demo store. The wallet is single-user: a profile (the @handle the
 * UI greets), a contact book to send to, and a seeded activity feed used ONLY in
 * demo mode (env not loaded). In live mode balance + history come straight from
 * @benzo/core (see chain.ts); the profile + contacts stay here (off-chain UX).
 */
export type Direction = "in" | "out";

export interface Contact {
  handle: string; // "@mara"
  name: string;
  tone?: "accent" | "amber" | "neutral";
}

export interface ActivityRow {
  id: string;
  /** shield | send | receive | unshield | cashIn | cashOut */
  type: string;
  name: string; // display name / @handle
  note: string; // plain-English line ("Paid you · Design work")
  amount: string; // stroops
  direction: Direction;
  status: "settled" | "pending" | "proving" | "arriving" | "failed";
  timestamp: number; // unix seconds
  txHash?: string;
  tone?: "accent" | "amber" | "neutral";
  /** true for seeded/demo-mode rows (NOT a real on-chain settlement). The UI
   *  badges these so a demo/seeded run can never be mistaken for live chain data. */
  demo?: boolean;
}

export interface Profile {
  handle: string;
  name: string;
}

let seq = 0;
export function id(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}${Date.now().toString(36)}`;
}
export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
/** whole dollars -> stroops (USDC 7dp). */
export function usd(dollars: number): string {
  return Math.round(dollars * 1e7).toString();
}

export interface WalletDb {
  profile: Profile;
  contacts: Contact[];
  /** seeded demo activity (used only when not live) */
  activity: ActivityRow[];
  /** seeded demo balance in stroops (used only when not live) */
  demoBalance: string;
}

export function seed(): WalletDb {
  const t = nowSec();
  return {
    profile: { handle: "@you", name: "You" },
    contacts: [
      { handle: "@ravi", name: "Ravi Mehta", tone: "accent" },
      { handle: "@mara", name: "Mara", tone: "neutral" },
      { handle: "@nico", name: "Nico", tone: "neutral" },
      { handle: "@lucia", name: "Lucía", tone: "accent" },
    ],
    demoBalance: usd(1240.5),
    activity: [
      {
        id: "act_1", type: "receive", name: "Ravi Mehta", note: "Paid you · Design work",
        amount: usd(200), direction: "in", status: "settled", timestamp: t - 1800, tone: "accent", demo: true,
      },
      {
        id: "act_2", type: "send", name: "@mara", note: "You sent · Rent split",
        amount: usd(50), direction: "out", status: "settled", timestamp: t - 5400, demo: true,
      },
      {
        id: "act_3", type: "cashOut", name: "Cash out to bank", note: "To your bank",
        amount: usd(300), direction: "out", status: "arriving", timestamp: t - 7200, tone: "amber", demo: true,
      },
      {
        id: "act_4", type: "receive", name: "@lucia", note: "Paid you · Lunch",
        amount: usd(18.5), direction: "in", status: "settled", timestamp: t - 90_000, tone: "accent", demo: true,
      },
    ],
  };
}

export const db: WalletDb = seed();
