// The sky behind every inner page: the same field, dimmed, still draggable; doodles here only drift (no cards).
import { useMemo } from "react";
import Field from "../universe/Field";
import { LIB, src } from "../../lib/glyphs";
import type { FieldDoodle } from "../../lib/types";

export default function Backdrop() {
  const doodles = useMemo<FieldDoodle[]>(() => LIB.filter((d, i) => d.group !== "page" && i % 2 === 0)
    .map((d) => ({ key: d.slug, src: src(d.slug), name: d.name, slug: d.slug, category: d.category, group: d.group as FieldDoodle["group"], tag: null })), []);
  return (
    <div className="fixed inset-0 -z-10" aria-hidden="true">
      <Field doodles={doodles} onSelect={() => {}} />
      <div className="pointer-events-none absolute inset-0 bg-ground/70" />
    </div>
  );
}
