pragma circom 2.2.2;
// Entry point: Shield with ASP membership tree of 16 levels + authorized-MVK
// registry tree of 16 levels.
include "./shield_impl.circom";
component main {public [commitment, amount, assetId, depositor, aspMembershipRoot, mvkTag, registeredMvkRoot]} = Shield(16, 16);
