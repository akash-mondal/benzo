pragma circom 2.2.2;
// Entry point: Unshield over the depth-32 pool tree with a 16-level deny SMT.
include "./unshield_impl.circom";
component main {public [root, assetId, nullifier, publicAmount, changeCommitment, extDataHash, aspNonMembershipRoot, changeMvkTag, registeredMvkRoot]} = Unshield(32, 16, 16);
