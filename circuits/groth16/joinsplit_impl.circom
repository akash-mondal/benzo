pragma circom 2.2.2;

// TRANSFER / join-split (2-in / 2-out) — the load-bearing circuit.
//
// Proves, in zero knowledge:
//   1. Input ownership: each input commitment opens to
//      Poseidon2(amount, pk, blinding, asset) with pk derived from the
//      private spend key.
//   2. Correct nullifier derivation:
//      nullifier = Poseidon2(spend_sk, leaf_index, NULLIFIER_DOMAIN).
//   3. Membership: each (non-dummy) input's Merkle path folds to the public
//      root. Dummy inputs (amount == 0, fresh random key) skip the root
//      check so 1-in spends don't leak arity.
//   4. Output correctness: each output commitment is well-formed, amounts
//      64-bit range-checked, and bound to a registered MVK via its tag.
//   5. Value conservation: sum(in) == sum(out) + fee, no inflation.
//   6. Distinct input nullifiers.
//   7. ext_data_hash is bound into the proof (relayer + ciphertexts can't
//      be swapped after proving).

include "./note.circom";
include "../lib/merkleProof.circom";
include "../lib/circomlib/circuits/comparators.circom";

template JoinSplit(levels, mvkLevels) {
    var nIns = 2;
    var nOuts = 2;

    /** PUBLIC INPUTS (order pinned; the pool builds this exact vector) **/
    signal input root;
    signal input assetId;
    signal input inputNullifier[nIns];
    signal input outputCommitment[nOuts];
    signal input fee;
    signal input extDataHash;
    signal input mvkTag[nOuts];
    signal input registeredMvkRoot;            // root of the authorized-MVK registry

    /** PRIVATE INPUTS **/
    signal input inAmount[nIns];
    signal input inOrgSpendId[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];          // == leaf index
    signal input inPathElements[nIns][levels];
    signal input outAmount[nOuts];
    signal input outPubkey[nOuts];
    signal input outBlinding[nOuts];
    signal input outMvkPub[nOuts];
    signal input mvkKeyMeta[nOuts];
    signal input mvkPathElements[nOuts][mvkLevels];
    signal input mvkPathIndices[nOuts];

    component inSpendKeys[nIns];
    component inKeypair[nIns];
    component inCommitment[nIns];
    component inNullifier[nIns];
    component inTree[nIns];
    component inCheckRoot[nIns];
    component inRange[nIns];

    var sumIns = 0;
    for (var tx = 0; tx < nIns; tx++) {
        // Hardening: range-check every input amount to 64 bits. A malicious
        // prover must not be able to feed a field-overflowing input amount to
        // unbalance the value-conservation equation (sumIns can wrap mod p).
        inRange[tx] = AmountCheck();
        inRange[tx].amount <== inAmount[tx];

        inSpendKeys[tx] = BenzoSpendKeys();
        inSpendKeys[tx].orgSpendId <== inOrgSpendId[tx];

        inKeypair[tx] = BenzoKeypair();
        inKeypair[tx].ak <== inSpendKeys[tx].ak;

        inCommitment[tx] = BenzoNoteCommitment();
        inCommitment[tx].amount      <== inAmount[tx];
        inCommitment[tx].recipientPk <== inKeypair[tx].publicKey;
        inCommitment[tx].blinding    <== inBlinding[tx];
        inCommitment[tx].assetId     <== assetId;

        inNullifier[tx] = BenzoNullifier();
        inNullifier[tx].nk        <== inSpendKeys[tx].nk;
        inNullifier[tx].leafIndex <== inPathIndices[tx];
        inNullifier[tx].out === inputNullifier[tx];

        inTree[tx] = MerkleProof(levels);
        inTree[tx].leaf        <== inCommitment[tx].out;
        inTree[tx].pathIndices <== inPathIndices[tx];
        for (var i = 0; i < levels; i++) {
            inTree[tx].pathElements[i] <== inPathElements[tx][i];
        }

        // Root check only for non-dummy inputs (amount != 0).
        inCheckRoot[tx] = ForceEqualIfEnabled();
        inCheckRoot[tx].in[0]   <== root;
        inCheckRoot[tx].in[1]   <== inTree[tx].root;
        inCheckRoot[tx].enabled <== inAmount[tx];

        sumIns += inAmount[tx];
    }

    component outCommitment[nOuts];
    component outRange[nOuts];
    component outTag[nOuts];
    component outMvkIsZero[nOuts];
    component outMvkLeaf[nOuts];
    component outMvkReg[nOuts];

    var sumOuts = 0;
    for (var tx = 0; tx < nOuts; tx++) {
        outCommitment[tx] = BenzoNoteCommitment();
        outCommitment[tx].amount      <== outAmount[tx];
        outCommitment[tx].recipientPk <== outPubkey[tx];
        outCommitment[tx].blinding    <== outBlinding[tx];
        outCommitment[tx].assetId     <== assetId;
        outCommitment[tx].out === outputCommitment[tx];

        outRange[tx] = AmountCheck();
        outRange[tx].amount <== outAmount[tx];

        outTag[tx] = BenzoMvkTag();
        outTag[tx].mvkPub   <== outMvkPub[tx];
        outTag[tx].blinding <== outBlinding[tx];
        outTag[tx].out === mvkTag[tx];

        // Each output's MVK must be a nonzero registered key (closes the audit P0).
        outMvkIsZero[tx] = IsZero();
        outMvkIsZero[tx].in <== outMvkPub[tx];
        outMvkIsZero[tx].out === 0;
        outMvkLeaf[tx] = BenzoMvkRegistryLeaf();
        outMvkLeaf[tx].mvkPub  <== outMvkPub[tx];
        outMvkLeaf[tx].keyMeta <== mvkKeyMeta[tx];
        outMvkReg[tx] = MerkleProof(mvkLevels);
        outMvkReg[tx].leaf        <== outMvkLeaf[tx].out;
        outMvkReg[tx].pathIndices <== mvkPathIndices[tx];
        for (var i = 0; i < mvkLevels; i++) {
            outMvkReg[tx].pathElements[i] <== mvkPathElements[tx][i];
        }
        outMvkReg[tx].root === registeredMvkRoot;

        sumOuts += outAmount[tx];
    }

    // Distinct nullifiers.
    component sameNullifier = IsEqual();
    sameNullifier.in[0] <== inputNullifier[0];
    sameNullifier.in[1] <== inputNullifier[1];
    sameNullifier.out === 0;

    // Fee range check, then value conservation.
    component feeRange = AmountCheck();
    feeRange.amount <== fee;
    sumIns === sumOuts + fee;

    // Bind extDataHash into the proof.
    signal extDataSquare <== extDataHash * extDataHash;
}
