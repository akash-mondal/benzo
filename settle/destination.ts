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
  [INSPECT](): string {
    return "[Destination]";
  }
}
