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
include "../lib/circomlib/circuits/comparators.circom";

template Unshield(levels, smtLevels, mvkLevels) {
    /** PUBLIC INPUTS (order pinned; the pool builds this exact vector) **/
    signal input root;
    signal input assetId;
    signal input nullifier;
    signal input publicAmount;
    signal input changeCommitment;
    signal input extDataHash;
    signal input aspNonMembershipRoot;
    signal input changeMvkTag;
    signal input registeredMvkRoot;   // root of the authorized-MVK registry

    /** PRIVATE INPUTS **/
    // input note
    signal input inAmount;
    signal input inOrgSpendId;
    signal input inBlinding;
    signal input inPathIndices;            // == leaf index
    signal input inPathElements[levels];
    // change note
    signal input changeAmount;
    signal input changePubkey;
    signal input changeBlinding;
    signal input changeMvkPub;
    // authorized-MVK registry membership of the change note's MVK
    signal input mvkKeyMeta;
    signal input mvkPathElements[mvkLevels];
    signal input mvkPathIndices;
    // sparse-Merkle non-membership witness (key = input commitment)
    signal input smtSiblings[smtLevels];
    signal input smtOldKey;
    signal input smtOldValue;
    signal input smtIsOld0;

    // Input ownership + commitment (key hierarchy: derive ak/nk from the root).
    component sk = BenzoSpendKeys();
    sk.orgSpendId <== inOrgSpendId;

    component kp = BenzoKeypair();
    kp.ak <== sk.ak;

    component cm = BenzoNoteCommitment();
    cm.amount      <== inAmount;
    cm.recipientPk <== kp.publicKey;
    cm.blinding    <== inBlinding;
    cm.assetId     <== assetId;

    // Nullifier derivation (from the separate nullifier key nk).
    component nf = BenzoNullifier();
    nf.nk        <== sk.nk;
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

    // changeMvkPub must be a nonzero registered MVK (closes the audit P0).
    component mvkIsZero = IsZero();
    mvkIsZero.in <== changeMvkPub;
    mvkIsZero.out === 0;
    component mvkLeaf = BenzoMvkRegistryLeaf();
    mvkLeaf.mvkPub  <== changeMvkPub;
    mvkLeaf.keyMeta <== mvkKeyMeta;
    component mvkReg = MerkleProof(mvkLevels);
    mvkReg.leaf        <== mvkLeaf.out;
    mvkReg.pathIndices <== mvkPathIndices;
    for (var i = 0; i < mvkLevels; i++) {
        mvkReg.pathElements[i] <== mvkPathElements[i];
    }
    mvkReg.root === registeredMvkRoot;

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
