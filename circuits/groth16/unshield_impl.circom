pragma circom 2.2.2;

// UNSHIELD / withdraw + proof-of-innocence.
//
// Spends one input note, releases a public amount, and re-shields the
// remainder into a change note. Adds the ASP **non-membership** obligation:
// a sparse-Merkle proof that the spent note's commitment is NOT in the
// deny-set — "proof-of-innocence" at the regulated exit edge. The withdrawer
// proves dissociation from flagged deposits without revealing which note
// was theirs.
//
// Public amount/recipient binding: public_amount is a public input checked
// by the pool against the actual SAC payout; the recipient and ciphertexts
// are bound via ext_data_hash.

include "./note.circom";
include "../lib/merkleProof.circom";
include "../lib/smt/smtverifier.circom";
include "../lib/circomlib/circuits/bitify.circom";

template Unshield(levels, smtLevels) {
    /** PUBLIC INPUTS (order pinned; the pool builds this exact vector) **/
    signal input root;
    signal input assetId;
    signal input nullifier;
    signal input publicAmount;
    signal input changeCommitment;
    signal input extDataHash;
    signal input aspNonMembershipRoot;
    signal input changeMvkTag;

    /** PRIVATE INPUTS **/
    // input note
    signal input inAmount;
    signal input inSpendSk;
    signal input inBlinding;
    signal input inPathIndices;            // == leaf index
    signal input inPathElements[levels];
    // change note
    signal input changeAmount;
    signal input changePubkey;
    signal input changeBlinding;
    signal input changeMvkPub;
    // sparse-Merkle non-membership witness (key = input commitment)
    signal input smtSiblings[smtLevels];
    signal input smtOldKey;
    signal input smtOldValue;
    signal input smtIsOld0;

    // Input ownership + commitment.
    component kp = BenzoKeypair();
    kp.spendSk <== inSpendSk;

    component cm = BenzoNoteCommitment();
    cm.amount      <== inAmount;
    cm.recipientPk <== kp.publicKey;
    cm.blinding    <== inBlinding;
    cm.assetId     <== assetId;

    // Nullifier derivation.
    component nf = BenzoNullifier();
    nf.spendSk   <== inSpendSk;
    nf.leafIndex <== inPathIndices;
    nf.out === nullifier;

    // Membership of the input note (always enforced — no dummies here).
    component tree = MerkleProof(levels);
    tree.leaf        <== cm.out;
    tree.pathIndices <== inPathIndices;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== inPathElements[i];
    }
    tree.root === root;

    // Change note correctness + MVK binding.
    component ccm = BenzoNoteCommitment();
    ccm.amount      <== changeAmount;
    ccm.recipientPk <== changePubkey;
    ccm.blinding    <== changeBlinding;
    ccm.assetId     <== assetId;
    ccm.out === changeCommitment;

    component ctag = BenzoMvkTag();
    ctag.mvkPub   <== changeMvkPub;
    ctag.blinding <== changeBlinding;
    ctag.out === changeMvkTag;

    // Range checks + value conservation:
    // in == public + change (fee-less exit; relayer fees live on transfer).
    component rIn = AmountCheck();
    rIn.amount <== inAmount;
    component rPub = AmountCheck();
    rPub.amount <== publicAmount;
    component rChange = AmountCheck();
    rChange.amount <== changeAmount;
    inAmount === publicAmount + changeAmount;

    // Proof-of-innocence: the spent commitment is NOT in the deny SMT.
    component poi = SMTVerifier(smtLevels);
    poi.enabled <== 1;
    poi.root    <== aspNonMembershipRoot;
    for (var i = 0; i < smtLevels; i++) {
        poi.siblings[i] <== smtSiblings[i];
    }
    poi.oldKey   <== smtOldKey;
    poi.oldValue <== smtOldValue;
    component old0 = Num2Bits(1);
    old0.in <== smtIsOld0;
    poi.isOld0 <== old0.out[0];
    poi.key   <== cm.out;
    poi.value <== cm.out;  // unused for non-inclusion; key presence is checked
    poi.fnc   <== 1;       // 1 = verify NON-inclusion

    // Bind extDataHash into the proof.
    signal extDataSquare <== extDataHash * extDataHash;
}
