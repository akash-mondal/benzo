// The product screens' kit, in the landing's language: glass panels over the night sky, the sand pill (the sky's hover
// label) for the one primary action, serif italic in the doodles' chrome for the figure a panel is about, sand-gold for
// what's live, tabular figures.
import type { ReactNode } from "react";
import { thousands } from "../../lib/api";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Panel({ children, className, pad = true, testid }: { children: ReactNode; className?: string; pad?: boolean; testid?: string }) {
  return <section className={cx("min-w-0 rounded-[22px] bg-[#1b2216b8] shadow-[0_1px_0_#ddd6c612_inset,0_24px_60px_-30px_#000] ring-1 ring-app-line backdrop-blur-xl", pad && "p-5 sm:p-7", className)} data-testid={testid}>{children}</section>;
}

export function H2({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <div className="mb-4 mt-12 flex items-baseline justify-between gap-4 first:mt-0"><h2>{children}</h2>{aside && <div className="hidden text-[13px] text-app-muted sm:block">{aside}</div>}</div>;
}

// A figure: a small grey label over a value, with an optional note under it.
export function Figure({ label, value, note, gold, testid }: { label: string; value: ReactNode; note?: ReactNode; gold?: boolean; testid?: string }) {
  return (
    <div className="min-w-0" data-testid={testid}>
      <div className="text-[12.5px] text-app-faint">{label}</div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
        {typeof value === "string" && / (zats|TAZ)$/.test(value)
          ? <><span className={cx("serif-figure truncate pb-0.5 text-[30px] leading-[1.1]", gold ? "chrome" : "text-app-text")}>{value.replace(/ (zats|TAZ)$/, "")}</span><span className="shrink-0 text-[13px] text-app-muted">{value.match(/(zats|TAZ)$/)![0]}</span></>
          : <span className={cx("serif-figure truncate pb-0.5 text-[30px] leading-[1.1]", gold ? "chrome" : "text-app-text")}>{value}</span>}
      </div>
      {note && <div className="mt-0.5 text-[13px] text-app-muted tabular-nums">{note}</div>}
    </div>
  );
}

const PILL: Record<string, string> = {
  live: "bg-[#e9cd841a] text-gold ring-1 ring-[#e9cd8440]", good: "bg-[#b9d98a14] text-[#c4e09a] ring-1 ring-[#c4e09a33]", bad: "bg-[#f0939a14] text-bad ring-1 ring-[#f0939a33]", wait: "bg-[#ddd6c60f] text-app-text ring-1 ring-app-line", plain: "bg-[#ddd6c60a] text-app-muted ring-1 ring-app-line",
};
export function Pill({ kind = "plain", children, testid }: { kind?: keyof typeof PILL; children: ReactNode; testid?: string }) {
  return <span className={cx("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12.5px] font-medium", PILL[kind])} data-testid={testid}>{kind === "live" && <span className="size-1.5 animate-pulse rounded-full bg-gold" />}{children}</span>;
}

// A round's state, as a person would say it.
export const STATE: Record<string, { word: string; kind: keyof typeof PILL }> = {
  OPEN: { word: "Taking bids", kind: "live" }, FROZEN: { word: "Bids closed", kind: "wait" }, "SEALED-WAIT": { word: "Waiting to open", kind: "wait" },
  OPENED: { word: "Opened", kind: "wait" }, CLEARED: { word: "Cleared", kind: "wait" }, SETTLING: { word: "Paying out", kind: "wait" },
  SETTLED: { word: "Settled", kind: "good" }, CANCELLED: { word: "Refunded", kind: "bad" }, REFUNDING: { word: "Refunding", kind: "bad" }, DRAFT: { word: "Draft", kind: "plain" },
};
export const StatePill = ({ state, live, testid }: { state: string; live?: boolean; testid?: string }) => {
  const s = live ? STATE.OPEN : STATE[state] ?? { word: state, kind: "plain" as const };
  return <Pill kind={s.kind} testid={testid}>{s.word}</Pill>;
};

type BtnProps = { children: ReactNode; href?: string; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; testid?: string; kind?: "primary" | "secondary" | "text"; full?: boolean; className?: string };
export function Btn({ children, href, onClick, type = "button", disabled, testid, kind = "primary", full, className }: BtnProps) {
  const cls = cx("inline-flex h-10 items-center justify-center gap-2 rounded-full text-[14px] font-semibold transition-[transform,background-color,color] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60", kind !== "text" && "px-5",
    kind === "primary" && "bg-sand text-ink shadow-[0_8px_24px_-12px_#ddd6c680] hover:bg-[#ebe5d6]", kind === "secondary" && "bg-[#ddd6c60d] text-app-text ring-1 ring-[#ddd6c62e] hover:bg-[#ddd6c61a]", kind === "text" && "text-app-muted hover:text-app-text",
    full && "w-full", className);
  return href ? <a href={href} className={cls} data-testid={testid}>{children}</a> : <button type={type} onClick={onClick} disabled={disabled} className={cls} data-testid={testid}>{children}</button>;
}

export const zats = (n: number | string | null | undefined) => (n === null || n === undefined || n === "" ? "—" : `${thousands(n)}`);

// Inputs: label above, 40px field, help under (only when it helps).
export const fieldCls = "h-11 w-full rounded-xl bg-[#0f140cb3] px-3.5 text-[15px] text-app-text outline-none ring-1 ring-app-line transition-shadow placeholder:text-app-faint hover:ring-[#ddd6c633] focus:ring-[#ddd6c680]";
export function Field({ label, help, children, htmlFor }: { label: string; help?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="grid content-start gap-1.5" htmlFor={htmlFor}>
      <span className="text-[13.5px] font-medium text-app-text">{label}</span>
      {children}
      {help && <span className="text-[13px] text-app-faint">{help}</span>}
    </label>
  );
}

export function ErrorLine({ children, testid }: { children: ReactNode; testid?: string }) {
  return <p className="rounded-xl bg-[#f0939a14] px-3.5 py-2.5 text-[14px] text-bad ring-1 ring-[#f0939a33]" role="alert" data-testid={testid}>{children}</p>;
}

// A value you may want to copy (an address, an id, a command).
export function Copyable({ value, display, testid }: { value: string; display?: string; testid?: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="min-w-0 truncate tabular-nums" data-testid={testid}>{display ?? value}</span>
      <button type="button" onClick={() => navigator.clipboard.writeText(value)} className="shrink-0 text-[13px] text-app-muted hover:text-app-text">Copy</button>
    </span>
  );
}

// The round's life, left to right: bids close, frozen, opens at drand round R, settled. The step now running is gold.
export function Timeline({ steps, testid }: { steps: { label: string; at: string; state: "done" | "now" | "next" }[]; testid?: string }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-4 sm:gap-2" data-testid={testid}>
      {steps.map((s) => (
        <li key={s.label} className="relative sm:pt-5">
          <span aria-hidden className={cx("absolute left-0 top-1.5 hidden h-[3px] w-full rounded-full sm:block", s.state === "done" ? "bg-app-muted" : s.state === "now" ? "bg-gold" : "bg-app-2")} />
          <div className={cx("text-[14px] font-medium", s.state === "next" ? "text-app-muted" : "text-app-text")}>{s.label}{s.state === "now" && <span className="ml-2 text-[12.5px] text-gold">now</span>}</div>
          <div className="text-[13px] text-app-faint tabular-nums">{s.at}</div>
        </li>
      ))}
    </ol>
  );
}

// "in 3h 20m", "18m ago"
export const rel = (unix: number, now = Date.now() / 1000) => {
  const d = Math.round(unix - now), a = Math.abs(d), h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), days = Math.floor(a / 86400);
  const span = days >= 2 ? `${days} days` : h ? `${h}h ${m}m` : m ? `${m}m` : `${a}s`;
  return d >= 0 ? `in ${span}` : `${span} ago`;
};

// What each of `benzo verify`'s checks proves, in plain words.
export const CHECK: Record<string, string> = {
  manifest: "The round's terms are signed by its operator", witness: "Two witnesses signed the frozen bids", freeze: "The frozen set of bids is complete and unchanged",
  receipts: "Every counted bid has a signed receipt", "missing-deposits": "No paid deposit was left out", clear: "The result follows from the opened bids",
  envelope: "Refund addresses stayed sealed", report: "The signers' opening reports agree", projection: "The summary matches the full record",
  accounting: "Money in equals money out", "accounting-strays": "Stray payments are accounted for", balances: "Balance payments are accounted for",
  "balance-refs": "Late balance refunds are attested", defaults: "Defaults match the signers' records", claims: "Refund claims are valid",
  "receipt-attestation": "Two signers attest the payment transaction", delivery: "Token deliveries are signed by their bidders", "delivery-list": "The delivery list is signed by two signers",
  "no-destinations": "No address or key was published",
};
export const checkName = (id: string) => CHECK[id] ?? id.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
export const marketTitle = (name: string) => (name === name.toUpperCase() ? name : name.toLowerCase());

// A drawn check or cross (never an emoji).
export const Tick = ({ ok = true }: { ok?: boolean }) => ok
  ? <svg viewBox="0 0 16 16" className="mt-[3px] size-4 shrink-0 text-[#b9e27a]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="passes"><path d="M3.5 8.5l3 3 6-7" /></svg>
  : <svg viewBox="0 0 16 16" className="mt-[3px] size-4 shrink-0 text-bad" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" role="img" aria-label="fails"><path d="M4 4l8 8M12 4l-8 8" /></svg>;

// A moment in the reader's own time: "4:31 PM" today, "Oct 26, 4:31 PM" otherwise.
export const when = (unix: number) => {
  const d = new Date(unix * 1000), now = new Date(), t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? t : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${t}`;
};

// A doodle from the sky, in its sand chrome.
export function Glyph({ name, className }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={cx("glyph", className ?? "size-8")} style={{ ["--g" as string]: `url(/doodles/${name}.svg?v=2)` }} />;
}
