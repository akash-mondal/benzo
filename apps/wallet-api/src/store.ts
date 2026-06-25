/**
 * Consumer-side store. The wallet is single-user: a profile (the @handle the UI
 * greets) and a contact book to send to. Balance and history come straight from
 * @benzo/core (see chain.ts); the profile + contacts stay off-chain UX state.
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
  /** true only for legacy unverified rows; live chain rows never set this. */
  unverified?: boolean;
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
export interface WalletDb {
  profile: Profile;
  contacts: Contact[];
  activity: ActivityRow[];
}

export function seed(): WalletDb {
  return {
    profile: { handle: "@you", name: "You" },
    contacts: [
      { handle: "@ravi", name: "Ravi Mehta", tone: "accent" },
      { handle: "@mara", name: "Mara", tone: "neutral" },
      { handle: "@nico", name: "Nico", tone: "neutral" },
      { handle: "@lucia", name: "Lucía", tone: "accent" },
    ],
    activity: [],
  };
}

export const db: WalletDb = seed();
