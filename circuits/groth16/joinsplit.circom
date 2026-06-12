pragma circom 2.2.2;
// Entry point: 2-in/2-out JoinSplit over the depth-32 pool tree (canonical DEPTH = 32).
include "./joinsplit_impl.circom";
component main {public [root, assetId, inputNullifier, outputCommitment, fee, extDataHash, mvkTag]} = JoinSplit(32);
