// Who can see what, before and after a round opens (after CompressRail's visibility matrix). Each cell is what that
// party can read, not what a screen chooses to show. The limits under the table come from docs/honest-limits.md.
import { cx } from "./ui";

const WHO = ["You", "Other bidders", "Operator", "Each signer", "Anyone"] as const;
type Cell = string; // "yes" | "no" | a short qualified answer
const ROWS: { phase: "before" | "after"; what: string; cells: Cell[] }[] = [
  { phase: "before", what: "Your price", cells: ["yes", "no", "no", "no", "no"] },
  { phase: "before", what: "That a sealed bid came in", cells: ["yes", "count only", "sealed copy", "sealed copy", "count only"] },
  { phase: "before", what: "Your refund address", cells: ["yes", "no", "no", "yes, to check payouts", "no"] },
  { phase: "after", what: "Every bid's price", cells: ["yes", "by bid number", "by bid number", "by bid number", "by bid number"] },
  { phase: "after", what: "Who placed each bid", cells: ["your own", "no", "network data*", "payout address", "no"] },
  { phase: "after", what: "Where each payment went", cells: ["your own", "no", "no", "yes", "amounts only"] },
];
const PHASE = { before: "Until the opening", after: "After the opening" };

function Mark({ v }: { v: Cell }) {
  if (v === "yes") return <span className="text-[#c4e09a]">Yes</span>;
  if (v === "no") return <span className="text-app-faint">No</span>;
  return <span className="text-app-text">{v.replace(/^./, (c) => c.toUpperCase())}</span>;
}

export function WhoSees({ now, compact }: { now?: "before" | "after"; compact?: boolean }) {
  return (
    <div data-testid="who-sees">
      <div className="overflow-x-auto">
        <table className={cx(compact ? "w-full min-w-[540px] border-collapse text-left" : "w-full min-w-[620px] border-collapse text-left", compact ? "text-[12.5px]" : "text-[13.5px]")}>
          <thead>
            <tr className="text-[12px] text-app-faint">
              <th className="py-2 pr-3 font-normal" scope="col">What</th>
              {WHO.map((w) => <th key={w} scope="col" className="px-2 py-2 font-normal">{w}</th>)}
            </tr>
          </thead>
          {(["before", "after"] as const).map((p) => (
            <tbody key={p} className={cx(now && now !== p && "opacity-60")}>
              <tr>
                <th colSpan={WHO.length + 1} scope="rowgroup" className="pt-3 pb-1 text-[12px] font-medium tracking-wide text-gold">
                  {PHASE[p]}{now === p ? " · now" : ""}
                </th>
              </tr>
              {ROWS.filter((r) => r.phase === p).map((r) => (
                <tr key={r.what} className="border-t border-app-line">
                  <th scope="row" className="py-2 pr-3 font-normal text-app-muted">{r.what}</th>
                  {r.cells.map((c, i) => <td key={i} className="px-2 py-2"><Mark v={c} /></td>)}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <ul className={cx("mt-3 grid gap-1 text-app-faint", compact ? "text-[12px]" : "text-[12.5px]")}>
        <li>Prices open at the drand round set in the terms. A drand quorum acting together could open them early.</li>
        <li>* The site you bid through sees your network address and timing. Use Tor or a VPN to hide them.</li>
        <li>Moving the escrowed funds takes two of the three signers. The operator alone can't.</li>
      </ul>
    </div>
  );
}
