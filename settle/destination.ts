// A bidder's shielded destination, opaque by construction (agent-friendly class F: four P0s and B37 were a
// destination reaching a public document or log). It never serializes: JSON.stringify throws, and string
// interpolation and util.inspect print "[Destination]". The address comes out only through reveal(), which
// belongs at payment construction and nowhere else.
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class Destination {
  readonly #ua: string;
  constructor(ua: string) {
    this.#ua = ua;
  }
  reveal(): string {
    return this.#ua;
  }
  equals(other: Destination | null | undefined): boolean {
    return !!other && other.#ua === this.#ua;
  }
  toJSON(): never {
    throw new Error("a Destination is never serialized; call reveal() only where the payment is built");
  }
  toString(): string {
    return "[Destination]";
  }
  // R78 (Reviewer R F-7): `==`, `+` or arithmetic on a Destination throws instead of comparing "[Destination]" strings,
  // which would make two different destinations look equal. Template strings still print "[Destination]".
  [Symbol.toPrimitive](hint: string): string {
    if (hint === "string") return "[Destination]";
    throw new Error("a Destination has no primitive value; compare with equals() or reveal() at payment construction");
  }
  [INSPECT](): string {
    return "[Destination]";
  }
}
