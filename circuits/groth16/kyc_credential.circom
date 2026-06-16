pragma circom 2.2.2;
// Entry point: ZK-KYC credential with a 16-level authorized-issuer registry.
include "./kyc_credential_impl.circom";
component main {public [issuerRegistryRoot, credType, currentTime, scope, identityNullifier, addressBinding, admitLeaf]} = KycCredential(16);
