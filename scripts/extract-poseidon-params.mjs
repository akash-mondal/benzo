#!/usr/bin/env node
// Extract the pinned Poseidon2 BN254 parameterization from the circom
// constants file into a single canonical JSON — the cross-language source of
// truth consumed by the @benzo/sdk TypeScript implementation.
//
// Provenance: circuits/lib/poseidon2/poseidon2_const.circom (Horizen Labs
// SAGE script output), the same constants pinned on-chain in
// contracts/common/soroban-utils/src/constants.rs and in the zkhash crate.

import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(
  new URL("../circuits/lib/poseidon2/poseidon2_const.circom", import.meta.url),
  "utf8",
);

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(t)`);
  if (start < 0) throw new Error(`missing ${name}`);
  // take everything until the matching closing of the function (next "function" or EOF)
  const next = src.indexOf("function ", start + 10);
  return src.slice(start, next < 0 ? src.length : next);
}

function branches(fnSrc) {
  // split on `if (t==N)` / `else if (t==N)` branches, capture return [...] body
  const out = {};
  const re = /t==(\d)\)\s*\{\s*return\s*\[([\s\S]*?)\];/g;
  let m;
  while ((m = re.exec(fnSrc))) {
    const t = Number(m[1]);
    const body = m[2];
    out[t] = body;
  }
  return out;
}

function parseFlat(body) {
  return body
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s).toString());
}

function parseNested(body, t) {
  // body is rows: [a, b, ...], [c, d, ...], ...
  const rows = [];
  const re = /\[([\s\S]*?)\]/g;
  let m;
  while ((m = re.exec(body))) rows.push(parseFlat(m[1]));
  for (const r of rows) {
    if (r.length !== t) throw new Error(`row width ${r.length} != t=${t}`);
  }
  if (rows.length !== 8) throw new Error(`expected 8 full-round rows, got ${rows.length}`);
  return rows;
}

const partialSrc = branches(extractFunction("POSEIDON_PARTIAL_ROUNDS"));
const fullSrc = branches(extractFunction("POSEIDON_FULL_ROUNDS"));
const diagSrc = branches(extractFunction("POSEIDON_INTERNAL_MAT_DIAG"));

const params = {
  field: "bn254-scalar",
  modulus:
    "21888242871839275222246405745257275088548364400416034343698204186575808495617",
  d: 5,
  roundsF: 8,
  roundsP: 56,
  instances: {},
};

for (const t of [2, 3, 4]) {
  const partial = parseFlat(partialSrc[t]);
  if (partial.length !== 56) throw new Error(`t=${t}: ${partial.length} partial consts`);
  params.instances[t] = {
    partialRoundConstants: partial,
    fullRoundConstants: parseNested(fullSrc[t], t),
    internalMatDiag: parseFlat(diagSrc[t]),
  };
}

const out = new URL("../circuits/poseidon_params/poseidon2_bn254.json", import.meta.url);
writeFileSync(out, JSON.stringify(params, null, 2));
console.log(`wrote ${out.pathname}`);
for (const t of [2, 3, 4]) {
  const i = params.instances[t];
  console.log(
    `t=${t}: partial=${i.partialRoundConstants.length} full=8x${i.fullRoundConstants[0].length} diag=${i.internalMatDiag.length}`,
  );
}
