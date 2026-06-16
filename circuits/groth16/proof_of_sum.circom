pragma circom 2.2.2;
// Entry point: proof-of-sum / disclose-total over the depth-32 pool tree, up to 4 notes.
include "./proof_of_sum_impl.circom";
component main {public [root, claimedTotal, assetId, context]} = ProofOfSum(32, 4);
