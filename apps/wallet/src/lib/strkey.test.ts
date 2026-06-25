import { describe, it, expect } from "vitest";
import { isValidStellarAddress, shortAddress } from "./strkey";

// Real testnet ed25519 public keys (from network.ts) - must pass the checksum.
const REAL = [
  "GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMP",
  "GD2U26BTLNEKRLM7AMXPO5T64I7SPRPUF26T44RHSJBLFI5YGRKLZMT7",
];

describe("isValidStellarAddress", () => {
  it("accepts real checksum-valid G-addresses", () => {
    for (const a of REAL) expect(isValidStellarAddress(a)).toBe(true);
  });

  it("rejects a shape-valid but checksum-broken address (typo'd last char)", () => {
    // same as REAL[0] with the final char flipped P→A: passes the regex, fails CRC
    expect(isValidStellarAddress("GBRMUZELYDNXSBYF5KOLLSV4XLQYNZJQNLXQ3HTFCWNRIBS3I6EUBCMA")).toBe(false);
  });

  it("rejects all-padding garbage that matches the shape", () => {
    expect(isValidStellarAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });

  it("rejects wrong-shape inputs (handles, empty, short)", () => {
    expect(isValidStellarAddress("@alice")).toBe(false);
    expect(isValidStellarAddress("")).toBe(false);
    expect(isValidStellarAddress("GABC")).toBe(false);
    // contract id (C…) is not an ed25519 public key
    expect(isValidStellarAddress("CB4VS4OCF6HEGCLSPM4E3ILNGP4KF5ZJ7JEXUJIJBUU5IZC2VPDVSJOT")).toBe(false);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidStellarAddress(`  ${REAL[0]}  `)).toBe(true);
  });
});

describe("shortAddress", () => {
  it("truncates long addresses to GABC…WXYZ form", () => {
    expect(shortAddress(REAL[0])).toBe("GBRM…BCMP");
  });
  it("leaves short strings untouched", () => {
    expect(shortAddress("@bob")).toBe("@bob");
  });
});
