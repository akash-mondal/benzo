pragma circom 2.2.2;

// Benzo shared note templates — the canonical cryptographic invariants.
//
//   commitment = Poseidon2(amount, recipient_pk, blinding, asset_id)
//                (t=4 permutation; asset_id occupies the capacity slot)
//   nullifier  = Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN)
//                (t=3 permutation; NULLIFIER_DOMAIN = 0x02 in the capacity slot)
//   keypair    : recipient_pk = Poseidon2(spend_sk, 0) with domain 0x03
//   mvk tag    : tag = Poseidon2(mvk_pub, blinding) with domain 0x05
//
// All Poseidon2 instances use the parameterization pinned in
// circuits/lib/poseidon2/poseidon2_const.circom — byte-identical to the
// Soroban CAP-0075 host-function parameters in contracts/common/soroban-utils.

include "../lib/poseidon2/poseidon2_hash.circom";
include "../lib/circomlib/circuits/bitify.circom";

// Domain-separation constants (capacity-slot values).
function NULLIFIER_DOMAIN() { return 0x02; }
function KEYPAIR_DOMAIN()   { return 0x03; }
function MVK_TAG_DOMAIN()   { return 0x05; }
function ASP_LEAF_DOMAIN()  { return 0x01; }

// recipient_pk = Poseidon2(spend_sk, 0) with the keypair domain.
template BenzoKeypair() {
    signal input  spendSk;
    signal output publicKey;

    component h = Poseidon2(2);
    h.inputs[0] <== spendSk;
    h.inputs[1] <== 0;
    h.domainSeparation <== KEYPAIR_DOMAIN();
    publicKey <== h.out;
}

// commitment = Poseidon2(amount, recipient_pk, blinding, asset_id)
// realized as the t=4 permutation over exactly those four field elements.
template BenzoNoteCommitment() {
    signal input  amount;
    signal input  recipientPk;
    signal input  blinding;
    signal input  assetId;
    signal output out;

    component h = Poseidon2(3);
    h.inputs[0] <== amount;
    h.inputs[1] <== recipientPk;
    h.inputs[2] <== blinding;
    h.domainSeparation <== assetId;
    out <== h.out;
}

// nullifier = Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN)
template BenzoNullifier() {
    signal input  spendSk;
    signal input  leafIndex;
    signal output out;

    component h = Poseidon2(2);
    h.inputs[0] <== spendSk;
    h.inputs[1] <== leafIndex;
    h.domainSeparation <== NULLIFIER_DOMAIN();
    out <== h.out;
}

// MVK binding tag: tag = Poseidon2(mvk_pub, blinding) — every note is bound
// to a registered Master Viewing Key; there is no path to an unauditable note.
template BenzoMvkTag() {
    signal input  mvkPub;
    signal input  blinding;
    signal output out;

    component h = Poseidon2(2);
    h.inputs[0] <== mvkPub;
    h.inputs[1] <== blinding;
    h.domainSeparation <== MVK_TAG_DOMAIN();
    out <== h.out;
}

// ASP allow-set leaf: Poseidon2(depositor_scalar, asp_blinding), domain 0x01.
template BenzoAspLeaf() {
    signal input  depositor;
    signal input  aspBlinding;
    signal output out;

    component h = Poseidon2(2);
    h.inputs[0] <== depositor;
    h.inputs[1] <== aspBlinding;
    h.domainSeparation <== ASP_LEAF_DOMAIN();
    out <== h.out;
}

// 64-bit range check for amounts.
template AmountCheck() {
    signal input amount;
    component n2b = Num2Bits(64);
    n2b.in <== amount;
}
