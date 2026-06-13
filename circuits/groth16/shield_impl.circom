pragma circom 2.2.2;

// SHIELD: public USDC -> shielded note.
//
// Proves, in zero knowledge:
//   1. The output commitment is well-formed for the (public) deposited
//      amount: commitment = Poseidon2(amount, recipient_pk, blinding, asset).
//      recipient_pk and blinding stay private — the public deposit hides who
//      can later spend the note.
//   2. amount is 64-bit range-checked.
//   3. The note is bound to a registered MVK: mvk_tag = Poseidon2(mvk_pub,
//      blinding) — the guaranteed-auditability invariant.
//   4. ASP allow-membership at the deposit edge: a leaf
//      Poseidon2(depositor, asp_blinding) is included under the ASP
//      membership root. `depositor` is computed by the pool from the
//      authorized depositing address, so the allowlist is enforced for the
//      address that actually signs the deposit.

include "./note.circom";
include "../lib/merkleProof.circom";

template Shield(aspLevels) {
    /** PUBLIC INPUTS (order pinned; the pool builds this exact vector) **/
    signal input commitment;
    signal input amount;
    signal input assetId;
    signal input depositor;           // keccak256(address XDR) mod p
    signal input aspMembershipRoot;
    signal input mvkTag;

    /** PRIVATE INPUTS **/
    signal input recipientPk;
    signal input blinding;
    signal input mvkPub;
    signal input aspBlinding;
    signal input aspPathElements[aspLevels];
    signal input aspPathIndices;

    // 1. Commitment well-formedness.
    component cm = BenzoNoteCommitment();
    cm.amount      <== amount;
    cm.recipientPk <== recipientPk;
    cm.blinding    <== blinding;
    cm.assetId     <== assetId;
    cm.out === commitment;

    // 2. Range check.
    component rc = AmountCheck();
    rc.amount <== amount;

    // 3. MVK binding.
    component tag = BenzoMvkTag();
    tag.mvkPub   <== mvkPub;
    tag.blinding <== blinding;
    tag.out === mvkTag;

    // 4. ASP allow-membership of the depositor.
    component leaf = BenzoAspLeaf();
    leaf.depositor   <== depositor;
    leaf.aspBlinding <== aspBlinding;

    component tree = MerkleProof(aspLevels);
    tree.leaf        <== leaf.out;
    tree.pathIndices <== aspPathIndices;
    for (var i = 0; i < aspLevels; i++) {
        tree.pathElements[i] <== aspPathElements[i];
    }
    tree.root === aspMembershipRoot;
}
