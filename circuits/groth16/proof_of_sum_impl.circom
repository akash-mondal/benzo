pragma circom 2.2.2;

// Benzo proof-of-sum / confidential disclose-total.
//
// Proves: "I own up to `nNotes` notes in the pool Merkle tree (one spend
// identity) whose amounts sum to EXACTLY `claimedTotal`" — revealing only the
// total, never the individual amounts, the count, or which leaves they are.
//
// This replaces the plaintext decrypt-and-sum disclosure (which leaked every
// individual amount to the auditor): the auditor now learns the cryptographically
// verified total and nothing else.
//
// Public  : root, claimedTotal, assetId, context
// Private : orgSpendId, and per slot { amount, blinding, pathIndices, pathElements }
//
// Sum-correctness (Summa/Maxwell hardening): every amount is 64-bit range-checked
// so the running sum cannot wrap mod p before the equality, and the constraint
// claimedTotal === sum binds the revealed total to the owned notes. Padding slots
// use amount 0 with the membership check disabled (ForceEqualIfEnabled), exactly
// like proof_of_balance, and contribute 0 to the sum.
//
// COMPLETENESS NOTE (follow-on, mainnet): this proves "I own notes summing to
// claimedTotal", not "these are ALL my in-scope notes" — a discloser could still
// UNDER-report by omitting a note. The set-completeness guarantee (bind the
// summed set to the universe of the org's registered-MVK-tagged notes) composes
// with the authorized-MVK registry binding and is added there.

include "./note.circom";
include "../lib/merkleProof.circom";
include "../lib/circomlib/circuits/comparators.circom";

template ProofOfSum(levels, nNotes) {
    // ---- public ----
    signal input root;         // a recent pool Merkle root
    signal input claimedTotal; // the total being disclosed (the only revealed figure)
    signal input assetId;      // asset domain (USDC SAC)
    signal input context;      // verifier-chosen binding (auditor/scope nonce)

    // ---- private ----
    signal input orgSpendId;
    signal input amount[nNotes];
    signal input blinding[nNotes];
    signal input pathIndices[nNotes];
    signal input pathElements[nNotes][levels];

    // Bind `context` into the constraint system (replay protection per disclosure).
    signal contextSq;
    contextSq <== context * context;

    // Single owner: recipientPk = Poseidon2(ak, 0), ak derived from the root.
    component sk = BenzoSpendKeys();
    sk.orgSpendId <== orgSpendId;
    component kp = BenzoKeypair();
    kp.ak <== sk.ak;

    component range[nNotes];
    component commit[nNotes];
    component tree[nNotes];
    component checkRoot[nNotes];

    var sum = 0;
    for (var i = 0; i < nNotes; i++) {
        // 64-bit range so the running sum cannot overflow the field.
        range[i] = AmountCheck();
        range[i].amount <== amount[i];

        // commitment = Poseidon2(amount, pk, blinding, assetId)
        commit[i] = BenzoNoteCommitment();
        commit[i].amount      <== amount[i];
        commit[i].recipientPk <== kp.publicKey;
        commit[i].blinding    <== blinding[i];
        commit[i].assetId     <== assetId;

        // Merkle membership to the public root (disabled for amount-0 padding).
        tree[i] = MerkleProof(levels);
        tree[i].leaf        <== commit[i].out;
        tree[i].pathIndices <== pathIndices[i];
        for (var j = 0; j < levels; j++) {
            tree[i].pathElements[j] <== pathElements[i][j];
        }
        checkRoot[i] = ForceEqualIfEnabled();
        checkRoot[i].in[0]   <== root;
        checkRoot[i].in[1]   <== tree[i].root;
        checkRoot[i].enabled <== amount[i];

        sum += amount[i];
    }

    // Exact total: the revealed claimedTotal equals the sum of the owned notes.
    // Amounts are 64-bit and nNotes <= 8, so sum < 2^67 — no field wrap.
    claimedTotal === sum;
}
