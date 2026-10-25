// The large ticket every inner page is printed on: sand stock with the flap cut, a heading row, an optional screen
// (a doodle turning under its status light), a perforated stub, then the page's parts.
import type { ReactNode } from "react";
import { Spinner } from "../universe/Card";

export function Ticket({ kind, title, sub, light, glyph, caption, children, wide = false }: {
  kind: string; title: string; sub?: ReactNode; light?: { word: string; color: string; glow?: string }; glyph?: string; caption?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  return (
    <article className={`card-in mx-auto w-full ${wide ? "max-w-[720px]" : "max-w-[560px]"} bg-surface text-ink`} style={{ clipPath: "polygon(44px 0, 100% 0, 100% 100%, 0 100%, 0 44px)" }}>
      <div className="h-11" />
      <h1 className="rise rise-1 px-6 font-sans text-[clamp(1.75rem,1.2rem+2vw,2.5rem)] text-ink" data-testid="ticket-title">{title}</h1>
      {sub && <p className="rise rise-1 max-w-[52ch] px-6 pt-2 font-serif text-[18px] leading-snug text-ink">{sub}</p>}
      {glyph && (
        <div className="rise rise-2 relative mx-6 mt-4 bg-leaf-deep px-3 pb-3 pt-2">
          {light && <p className="absolute right-3 top-2.5 z-10 flex items-center gap-1.5 font-sans text-[13px] text-sand/85" data-testid="ticket-light">{light.word}<span className={`size-1.5 rounded-full ${light.color}`} /></p>}
          <Spinner src={`/doodles/${glyph}.svg`} className="h-36 w-full" />
          <div className="text-center font-sans text-[13px] text-sand/80">{kind}{caption ? <> · {caption}</> : null}</div>
        </div>
      )}
      <div className="relative mt-6">
        <div className="border-t-2 border-dotted border-ink/25" />
        <span aria-hidden className="absolute -left-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-ground" />
        <span aria-hidden className="absolute -right-2.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-ground" />
      </div>
      <div className="rise rise-3 px-6 pb-7 pt-5">{children}</div>
    </article>
  );
}

// One part of a ticket: a plain heading and its content, separated from the next by space.
export function Part({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="rise rise-4 mt-7 first:mt-0" aria-labelledby={id}>
      <h2 id={id} className="font-sans text-[15px] tracking-tight text-ink">{title}</h2>
      <div className="mt-2 font-serif text-[16px] leading-relaxed text-ink">{children}</div>
    </section>
  );
}

// A two-ended row: label left, value right (tabular).
export function Row({ k, v, testid }: { k: ReactNode; v: ReactNode; testid?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 font-sans text-[14px]" data-testid={testid}>
      <span className="text-muted">{k}</span><span className="text-right tabular text-ink">{v}</span>
    </div>
  );
}

export const Button = ({ children, href, onClick, type = "button", disabled, testid, quiet }: { children: ReactNode; href?: string; onClick?: () => void; type?: "button" | "submit"; disabled?: boolean; testid?: string; quiet?: boolean }) => {
  const cls = `inline-flex h-11 items-center justify-center px-4 font-sans text-[14px] font-medium transition-transform active:scale-[0.98] disabled:opacity-50 ${quiet ? "text-moss underline-offset-4 hover:underline" : "bg-moss text-white hover:bg-leaf"}`;
  return href ? <a href={href} className={cls} data-testid={testid}>{children}</a> : <button type={type} onClick={onClick} disabled={disabled} className={cls} data-testid={testid}>{children}</button>;
};
