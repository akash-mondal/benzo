//! BenzoEscrow — Solana cross-chain escrow released only by 2-of-3 attested Benzo clearing results.
//!
//! Design: docs/design/crosschain.md §1–§3, §9 (Track B, Phase 5 part 3): lock; `submit_attestation`
//! (2-of-3 attestations, once per (auction_id, batch_index), written to the `Approval` PDA);
//! `release_approved` (anyone, no signatures, repeatedly until every leaf is paid); refund after
//! deadline. §9's "attest once, release many": the attestations and their Ed25519 verification
//! instructions live in one submit transaction, and every later release transaction carries only
//! payouts — so many payouts fit per transaction (the before/after table is measured by
//! `contracts/solana/test/driver.mjs` and recorded in `docs/STATUS-B.md`).
//!
//! Attestation checking (design §1): each signer holds its own Ed25519 key; the crank submits the
//! `submit_attestation` instruction immediately after a native Ed25519 verification instruction.
//! This program reads that instruction through the **checked** instructions sysvar
//! (`load_instruction_at_checked` + `load_current_index_checked`, and an explicit
//! `sysvar::instructions::ID` comparison — the 2022 Wormhole spoofed-sysvar class) and enforces
//! strict offsets: signature and public-key slices must live inside the verification instruction
//! itself (`*_instruction_index == u16::MAX`), and the verified message must be exactly this
//! submit instruction's own attestation bytes (`message_instruction_index == current`,
//! `offset == 2`, `size == 200`) — the precompile's cross-instruction data referencing is only ever
//! accepted at that one exact location.
//!
//! Attestation message (fixed layout, design §1, 200 bytes), what each signer signs:
//!
//! ```text
//! "benzo-release-v1" (16) ‖ genesis_hash (32) ‖ program_id (32) ‖ auction_id (32)
//!   ‖ result_hash (32) ‖ allocation_root (32) ‖ batch_index u64be ‖ nonce u64be ‖ expiry i64be
//! ```
//!
//! Solana has no genesis-hash sysvar, so the cluster genesis hash is pinned into the auction at
//! `lock` (the locker's client supplies `getGenesisHash`) and every attestation must carry it,
//! together with this program's own ID: an attestation minted for another cluster or deployment
//! is refused (`BadBinding`). Attestation replay is refused because the `Approval` PDA is created
//! exactly once per `(auction_id, batch_index)` (`init` semantics: a second submit fails with
//! `BatchReplayed` — counted only when the account is program-owned with the `APPROVAL_V1`
//! marker, so a dusted PDA can neither fake nor block it) and each allocation leaf is payable at
//! most once (the paid PDA — `PAID_V1` marker, written before
//! any lamports move — P0 effects-before-interactions ordering; Solana has no transfer CPI to a
//! recipient here, so no callback exists, but the ordering is kept explicit).
//!
//! `release_approved` takes the `Approval` PDA and the auction account with **no signatures**:
//! the approval was fully verified at submit time; the release transaction checks `now <= expiry`,
//! the auction is not refunded, and per payout the leaf bound + Merkle membership against the
//! approval's `allocation_root`, the paid-flag PDA unset, the cap (`paid + amount <= locked`), sets
//! the paid flag, then moves the lamports. Anyone may call it repeatedly (the crank) until every
//! leaf is paid; per-recipient failures skip and stay claimable.
//!
//! Canonical leaf/root layout (design §3, identical to `contracts/evm/src/BenzoEscrow.sol` and
//! `crosschain/`):
//!
//! ```text
//! leaf = keccak256("benzo-leaf-v1" ‖ auction_id(32) ‖ index u64be ‖ asset(32) ‖ lot_count u64be
//!                   ‖ destination_kind(u8) ‖ destination_bytes)
//! root = keccak256("benzo-root-v1" ‖ leaf_count u64be ‖ tree_root)
//! tree: sorted-pair keccak parents; amount = lot_count × standard_lot (never in a leaf).
//! ```
//!
//! On Solana `destination_kind = 2` (32-byte pubkey) and `asset = 32` zero bytes (native SOL).

use solana_keccak_hasher::hashv;
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    ed25519_program,
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::{
        instructions::{
            load_current_index_checked, load_instruction_at_checked, ID as IX_SYSVAR_ID,
        },
        Sysvar,
    },
};

entrypoint!(process_instruction);

pub const VERSION: u8 = 1;
pub const TAG_LOCK: u8 = 1;
pub const TAG_SUBMIT_ATTESTATION: u8 = 2;
pub const TAG_REFUND: u8 = 3;
pub const TAG_RELEASE_APPROVED: u8 = 4;

pub const LEAF_PREFIX: &[u8] = b"benzo-leaf-v1";
pub const ROOT_PREFIX: &[u8] = b"benzo-root-v1";
pub const RELEASE_PREFIX: &[u8] = b"benzo-release-v1"; // 16 bytes

pub const ATT_LEN: usize = 16 + 32 * 5 + 8 * 3; // 200
pub const DEST_SOLANA: u8 = 2;
pub const ASSET_SOL: [u8; 32] = [0u8; 32];
/// R9 item 1 (F-2): the account layout changed (the `layout_version` byte below), so this build
/// ships under a **new program ID** — a layout or marker change is never an in-place upgrade over
/// live auctions. The state account records its account-layout version and every instruction
/// checks it before interpreting the bytes (a second line of defence behind that deployment
/// rule: an old-layout account is refused with `BadLayout`, never read as garbage). The pre-R9
/// 235-byte layout is v1 and has no such byte.
pub const LAYOUT_VERSION: u8 = 2;
pub const STATE_LEN: usize = 236;
/// §10 item 1 (F-1): a paid flag counts only if this program owns the account and its data
/// carries this versioned marker — never infer state from lamports or empty data.
pub const PAID_MARKER: &[u8] = b"PAID_V1";
pub const PAID_LEN: usize = PAID_MARKER.len(); // 7
/// §10 item 3 (F-3): the same rule for the `Approval` PDA — `BatchReplayed` only when the
/// account is program-owned with this marker.
pub const APPROVAL_MARKER: &[u8] = b"APPROVAL_V1";
pub const APPROVAL_LEN: usize = 11 + 153; // marker + the §9 fields
pub const MAX_PAYOUTS: usize = 64;
pub const MAX_PROOF: usize = 32;

// state offsets
const S_VERSION: usize = 0;
const S_BUMP: usize = 1;
const S_REFUNDED: usize = 2;
const S_AUCTION: usize = 3; // 32
const S_GENESIS: usize = 35; // 32
const S_SIGNER0: usize = 67; // 32
const S_SIGNER1: usize = 99;
const S_SIGNER2: usize = 131;
const S_RETURN: usize = 163;
const S_AMOUNT: usize = 195; // u64 le
const S_LOT: usize = 203;
const S_PAID: usize = 211;
const S_LOCK_UNTIL: usize = 219; // i64 le
const S_DEADLINE: usize = 227;
const S_LAYOUT_VERSION: usize = 235; // u8, LAYOUT_VERSION (R9 item 1)

// approval layout: APPROVAL_V1 marker (11), then exactly the §9 fields: auction_id,
// batch_index(u64 le), allocation_root, result_hash, nonce(u64 le), expiry(i64 le), genesis_hash, bump
const A_MARKER: usize = 0; // 11
const A_AUCTION: usize = 11; // 32
const A_BATCH: usize = 43; // u64 le
const A_ROOT: usize = 51; // 32
const A_RESULT: usize = 83; // 32
const A_NONCE: usize = 115; // u64 le
const A_EXPIRY: usize = 123; // i64 le
const A_GENESIS: usize = 131; // 32
const A_BUMP: usize = 163; // u8

#[derive(Clone, Copy)]
struct Auction {
    bump: u8,
    refunded: bool,
    auction_id: [u8; 32],
    genesis: [u8; 32],
    signers: [[u8; 32]; 3],
    return_to: Pubkey,
    amount: u64,
    standard_lot: u64,
    paid: u64,
    lock_until: i64,
    deadline: i64,
}

/// The `Approval` PDA (design §9): created exactly once per (auction_id, batch_index) by
/// `submit_attestation`, read (never written) by `release_approved`.
#[derive(Clone, Copy)]
struct Approval {
    auction_id: [u8; 32],
    batch_index: u64,
    allocation_root: [u8; 32],
    result_hash: [u8; 32],
    nonce: u64,
    expiry: i64,
    genesis: [u8; 32],
    bump: u8,
}

/// Error codes are asserted by name/number in `contracts/solana/test/driver.mjs`.
#[repr(u32)]
pub enum EscrowError {
    BadInstruction = 1,
    BadAccount = 2,
    AlreadyLocked = 3,
    LockClosed = 4,
    BadParameters = 5,
    UnknownAuction = 6,
    Refunded = 7,
    Expired = 8,
    BatchReplayed = 9,
    BadSysvar = 10,
    BadEd25519 = 11,
    Quorum = 12,
    MessageMismatch = 13,
    LeafBound = 14,
    NotInRoot = 15,
    BeforeDeadline = 16,
    AlreadyRefunded = 17,
    BadBinding = 18,
    NoApproval = 19,
    /// R9 item 1: the state account records an account-layout version this program does not
    /// interpret (e.g. an old-layout account left by an in-place upgrade).
    BadLayout = 20,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], ProgramError> {
        let end = self.pos.checked_add(n).ok_or(ProgramError::InvalidInstructionData)?;
        if end > self.data.len() {
            return Err(EscrowError::BadInstruction.into());
        }
        let s = &self.data[self.pos..end];
        self.pos = end;
        Ok(s)
    }
    fn u8(&mut self) -> Result<u8, ProgramError> {
        Ok(self.take(1)?[0])
    }
    fn u16(&mut self) -> Result<u16, ProgramError> {
        Ok(u16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, ProgramError> {
        Ok(u64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, ProgramError> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn arr32(&mut self) -> Result<[u8; 32], ProgramError> {
        Ok(self.take(32)?.try_into().unwrap())
    }
    fn end(&self) -> bool {
        self.pos == self.data.len()
    }
}

fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    hashv(parts).0
}

/// sorted-pair keccak parent (OpenZeppelin `Hashes.commutativeKeccak256` convention)
fn parent(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    if a <= b {
        keccak(&[a, b])
    } else {
        keccak(&[b, a])
    }
}

fn leaf_hash(
    auction_id: &[u8; 32],
    index: u64,
    asset: &[u8; 32],
    lot_count: u64,
    destination_kind: u8,
    destination: &[u8],
) -> [u8; 32] {
    keccak(&[
        LEAF_PREFIX,
        auction_id,
        &index.to_be_bytes(),
        asset,
        &lot_count.to_be_bytes(),
        &[destination_kind],
        destination,
    ])
}

fn root_hash(leaf_count: u64, tree_root: &[u8; 32]) -> [u8; 32] {
    keccak(&[ROOT_PREFIX, &leaf_count.to_be_bytes(), tree_root])
}

/// A flag account counts as set only if **this program** owns it and its data carries the
/// versioned marker (§10 items 1/3): lamports or empty data prove nothing — anyone can dust a
/// predictable PDA with lamports.
fn flag_is_set(ai: &AccountInfo, program_id: &Pubkey, marker: &[u8]) -> bool {
    if ai.owner != program_id || ai.data_len() < marker.len() {
        return false;
    }
    match ai.try_borrow_data() {
        Ok(d) => &d[..marker.len()] == marker,
        Err(_) => false,
    }
}

/// Create a flag account carrying `marker`, safely when the PDA already holds lamports (§10
/// items 1/3): a dusted PDA (system-owned, empty) is topped up to rent-exempt and completed with
/// `allocate` + `assign` via `invoke_signed` with the PDA seeds; a fresh PDA uses
/// `create_account`. Dusting therefore cannot create the flag's semantics and cannot block it.
fn create_flag<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    flag_ai: &AccountInfo<'a>,
    system_program_ai: &AccountInfo<'a>,
    seeds: &[&[u8]],
    marker: &[u8],
    space: usize,
) -> ProgramResult {
    let needed = Rent::get()?.minimum_balance(space);
    if flag_ai.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(payer.key, flag_ai.key, needed, space as u64, program_id),
            &[payer.clone(), flag_ai.clone(), system_program_ai.clone()],
            &[seeds],
        )?;
    } else {
        // pre-funded (possibly dusted): top up to rent-exempt, then allocate + assign
        if flag_ai.lamports() < needed {
            invoke(
                &system_instruction::transfer(payer.key, flag_ai.key, needed - flag_ai.lamports()),
                &[payer.clone(), flag_ai.clone(), system_program_ai.clone()],
            )?;
        }
        invoke_signed(
            &system_instruction::allocate(flag_ai.key, space as u64),
            &[flag_ai.clone(), system_program_ai.clone()],
            &[seeds],
        )?;
        invoke_signed(
            &system_instruction::assign(flag_ai.key, program_id),
            &[flag_ai.clone(), system_program_ai.clone()],
            &[seeds],
        )?;
    }
    let mut data = flag_ai.try_borrow_mut_data()?;
    data[..marker.len()].copy_from_slice(marker);
    Ok(())
}

fn load_state(data: &[u8]) -> Result<Auction, ProgramError> {
    if data.len() != STATE_LEN || data[S_VERSION] != VERSION {
        return Err(EscrowError::UnknownAuction.into());
    }
    // R9 item 1: the recorded layout version is checked before any field is interpreted —
    // every instruction that reads state goes through here
    if data[S_LAYOUT_VERSION] != LAYOUT_VERSION {
        return Err(EscrowError::BadLayout.into());
    }
    Ok(Auction {
        bump: data[S_BUMP],
        refunded: data[S_REFUNDED] != 0,
        auction_id: data[S_AUCTION..S_AUCTION + 32].try_into().unwrap(),
        genesis: data[S_GENESIS..S_GENESIS + 32].try_into().unwrap(),
        signers: [
            data[S_SIGNER0..S_SIGNER0 + 32].try_into().unwrap(),
            data[S_SIGNER1..S_SIGNER1 + 32].try_into().unwrap(),
            data[S_SIGNER2..S_SIGNER2 + 32].try_into().unwrap(),
        ],
        return_to: Pubkey::new_from_array(data[S_RETURN..S_RETURN + 32].try_into().unwrap()),
        amount: u64::from_le_bytes(data[S_AMOUNT..S_AMOUNT + 8].try_into().unwrap()),
        standard_lot: u64::from_le_bytes(data[S_LOT..S_LOT + 8].try_into().unwrap()),
        paid: u64::from_le_bytes(data[S_PAID..S_PAID + 8].try_into().unwrap()),
        lock_until: i64::from_le_bytes(data[S_LOCK_UNTIL..S_LOCK_UNTIL + 8].try_into().unwrap()),
        deadline: i64::from_le_bytes(data[S_DEADLINE..S_DEADLINE + 8].try_into().unwrap()),
    })
}

fn store_state(data: &mut [u8], a: &Auction) -> Result<(), ProgramError> {
    if data.len() != STATE_LEN {
        return Err(EscrowError::BadAccount.into());
    }
    data[S_VERSION] = VERSION;
    data[S_BUMP] = a.bump;
    data[S_REFUNDED] = a.refunded as u8;
    data[S_AUCTION..S_AUCTION + 32].copy_from_slice(&a.auction_id);
    data[S_GENESIS..S_GENESIS + 32].copy_from_slice(&a.genesis);
    data[S_SIGNER0..S_SIGNER0 + 32].copy_from_slice(&a.signers[0]);
    data[S_SIGNER1..S_SIGNER1 + 32].copy_from_slice(&a.signers[1]);
    data[S_SIGNER2..S_SIGNER2 + 32].copy_from_slice(&a.signers[2]);
    data[S_RETURN..S_RETURN + 32].copy_from_slice(a.return_to.as_ref());
    data[S_AMOUNT..S_AMOUNT + 8].copy_from_slice(&a.amount.to_le_bytes());
    data[S_LOT..S_LOT + 8].copy_from_slice(&a.standard_lot.to_le_bytes());
    data[S_PAID..S_PAID + 8].copy_from_slice(&a.paid.to_le_bytes());
    data[S_LOCK_UNTIL..S_LOCK_UNTIL + 8].copy_from_slice(&a.lock_until.to_le_bytes());
    data[S_DEADLINE..S_DEADLINE + 8].copy_from_slice(&a.deadline.to_le_bytes());
    data[S_LAYOUT_VERSION] = LAYOUT_VERSION;
    Ok(())
}

fn load_approval(data: &[u8]) -> Result<Approval, ProgramError> {
    if data.len() != APPROVAL_LEN || &data[A_MARKER..A_MARKER + 11] != APPROVAL_MARKER {
        return Err(EscrowError::NoApproval.into());
    }
    Ok(Approval {
        auction_id: data[A_AUCTION..A_AUCTION + 32].try_into().unwrap(),
        batch_index: u64::from_le_bytes(data[A_BATCH..A_BATCH + 8].try_into().unwrap()),
        allocation_root: data[A_ROOT..A_ROOT + 32].try_into().unwrap(),
        result_hash: data[A_RESULT..A_RESULT + 32].try_into().unwrap(),
        nonce: u64::from_le_bytes(data[A_NONCE..A_NONCE + 8].try_into().unwrap()),
        expiry: i64::from_le_bytes(data[A_EXPIRY..A_EXPIRY + 8].try_into().unwrap()),
        genesis: data[A_GENESIS..A_GENESIS + 32].try_into().unwrap(),
        bump: data[A_BUMP],
    })
}

fn store_approval(data: &mut [u8], a: &Approval) -> Result<(), ProgramError> {
    if data.len() != APPROVAL_LEN {
        return Err(EscrowError::BadAccount.into());
    }
    data[A_MARKER..A_MARKER + 11].copy_from_slice(APPROVAL_MARKER);
    data[A_AUCTION..A_AUCTION + 32].copy_from_slice(&a.auction_id);
    data[A_BATCH..A_BATCH + 8].copy_from_slice(&a.batch_index.to_le_bytes());
    data[A_ROOT..A_ROOT + 32].copy_from_slice(&a.allocation_root);
    data[A_RESULT..A_RESULT + 32].copy_from_slice(&a.result_hash);
    data[A_NONCE..A_NONCE + 8].copy_from_slice(&a.nonce.to_le_bytes());
    data[A_EXPIRY..A_EXPIRY + 8].copy_from_slice(&a.expiry.to_le_bytes());
    data[A_GENESIS..A_GENESIS + 32].copy_from_slice(&a.genesis);
    data[A_BUMP] = a.bump;
    Ok(())
}

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    let mut r = Reader::new(data);
    if r.u8()? != VERSION {
        return Err(EscrowError::BadInstruction.into());
    }
    match r.u8()? {
        TAG_LOCK => lock(program_id, accounts, &mut r),
        TAG_SUBMIT_ATTESTATION => submit_attestation(program_id, accounts, &mut r),
        TAG_REFUND => refund(program_id, accounts, &mut r),
        TAG_RELEASE_APPROVED => release_approved(program_id, accounts, &mut r),
        _ => Err(EscrowError::BadInstruction.into()),
    }
}

fn lock(program_id: &Pubkey, accounts: &[AccountInfo], r: &mut Reader) -> ProgramResult {
    let iter = &mut accounts.iter();
    let seller = next_account_info(iter)?;
    let auction_ai = next_account_info(iter)?;
    let system_program_ai = next_account_info(iter)?;
    if !seller.is_signer || !seller.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if !auction_ai.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if system_program_ai.key != &solana_program::system_program::ID {
        return Err(EscrowError::BadAccount.into());
    }

    let auction_id = r.arr32()?;
    let genesis = r.arr32()?;
    let amount = r.u64()?;
    let standard_lot = r.u64()?;
    let lock_until = r.i64()?;
    let deadline = r.i64()?;
    let signers = [r.arr32()?, r.arr32()?, r.arr32()?];
    let return_to = Pubkey::new_from_array(r.arr32()?);
    if !r.end() {
        return Err(EscrowError::BadInstruction.into());
    }

    if amount == 0 || standard_lot == 0 || amount % standard_lot != 0 {
        return Err(EscrowError::BadParameters.into());
    }
    if deadline < lock_until {
        return Err(EscrowError::BadParameters.into());
    }
    if return_to == Pubkey::default() {
        return Err(EscrowError::BadParameters.into());
    }
    if signers[0] == [0u8; 32]
        || signers[1] == [0u8; 32]
        || signers[2] == [0u8; 32]
        || signers[0] == signers[1]
        || signers[0] == signers[2]
        || signers[1] == signers[2]
    {
        return Err(EscrowError::BadParameters.into());
    }

    let (pda, bump) =
        Pubkey::find_program_address(&[b"escrow", &auction_id], program_id);
    if pda != *auction_ai.key {
        return Err(EscrowError::BadAccount.into());
    }
    // A locked auction counts only if this program owns the state PDA with STATE_LEN data (§10
    // pattern, R8 G9): lamports or empty data prove nothing — anyone can dust the predictable PDA
    // before lock. A dusted PDA is topped up to rent-exempt + amount and completed with
    // `allocate` + `assign` via `invoke_signed` with the PDA seeds (exactly `create_flag`), so
    // dust can neither block the auction nor fake a lock.
    if auction_ai.owner == program_id && auction_ai.data_len() == STATE_LEN {
        // R9 item 1: check the recorded layout version before calling it "already locked" —
        // an old-layout account is refused, never interpreted as this layout's state
        if auction_ai.try_borrow_data()?[S_LAYOUT_VERSION] != LAYOUT_VERSION {
            return Err(EscrowError::BadLayout.into());
        }
        return Err(EscrowError::AlreadyLocked.into());
    }
    let now = Clock::get()?.unix_timestamp;
    if now > lock_until {
        return Err(EscrowError::LockClosed.into());
    }

    let rent = Rent::get()?;
    let lamports = rent
        .minimum_balance(STATE_LEN)
        .checked_add(amount)
        .ok_or(EscrowError::BadParameters)?;
    if auction_ai.lamports() == 0 {
        invoke_signed(
            &system_instruction::create_account(
                seller.key,
                auction_ai.key,
                lamports,
                STATE_LEN as u64,
                program_id,
            ),
            &[seller.clone(), auction_ai.clone(), system_program_ai.clone()],
            &[&[b"escrow", &auction_id, &[bump]]],
        )?;
    } else {
        // pre-funded (possibly dusted): top up to rent-exempt + amount, then allocate + assign
        if auction_ai.lamports() < lamports {
            invoke(
                &system_instruction::transfer(seller.key, auction_ai.key, lamports - auction_ai.lamports()),
                &[seller.clone(), auction_ai.clone(), system_program_ai.clone()],
            )?;
        }
        invoke_signed(
            &system_instruction::allocate(auction_ai.key, STATE_LEN as u64),
            &[auction_ai.clone(), system_program_ai.clone()],
            &[&[b"escrow", &auction_id, &[bump]]],
        )?;
        invoke_signed(
            &system_instruction::assign(auction_ai.key, program_id),
            &[auction_ai.clone(), system_program_ai.clone()],
            &[&[b"escrow", &auction_id, &[bump]]],
        )?;
    }

    let state = Auction {
        bump,
        refunded: false,
        auction_id,
        genesis,
        signers,
        return_to,
        amount,
        standard_lot,
        paid: 0,
        lock_until,
        deadline,
    };
    let mut data = auction_ai.try_borrow_mut_data()?;
    store_state(&mut data, &state)
}

struct Payout {
    index: u64,
    lot_count: u64,
    destination_kind: u8,
    destination: [u8; 32],
    leaf_count: u64,
    proof: Vec<[u8; 32]>,
}

/// `submit_attestation` (design §9): verify 2-of-3 attestations and write the `Approval` PDA.
/// Same checks as the old signature-carrying release: the preceding native Ed25519 instruction is
/// read through the checked instructions sysvar (account key == `sysvar::instructions::ID`,
/// `load_instruction_at_checked`, strict offsets); 2-of-3 distinct signers from the auction's
/// pinned set; the message is exactly the attestation bytes; the genesis hash matches the one
/// pinned at lock; `now <= expiry`; the auction is not refunded. On success the `Approval` PDA is
/// written. No transfers happen in this instruction.
fn submit_attestation(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    r: &mut Reader,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let crank = next_account_info(iter)?;
    let auction_ai = next_account_info(iter)?;
    let instructions_ai = next_account_info(iter)?;
    let approval_ai = next_account_info(iter)?;
    let system_program_ai = next_account_info(iter)?;
    if !crank.is_signer || !crank.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if !approval_ai.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if system_program_ai.key != &solana_program::system_program::ID {
        return Err(EscrowError::BadAccount.into());
    }

    // the spoofed-sysvar refusal: this account must be the real instructions sysvar
    if instructions_ai.key != &IX_SYSVAR_ID {
        return Err(EscrowError::BadSysvar.into());
    }

    let att = r.take(ATT_LEN)?;
    if !r.end() {
        return Err(EscrowError::BadInstruction.into());
    }

    // attestation fields (fixed layout)
    if &att[0..16] != RELEASE_PREFIX {
        return Err(EscrowError::MessageMismatch.into());
    }
    let att_genesis = &att[16..48];
    let att_program = &att[48..80];
    let att_auction = &att[80..112];
    let att_result: [u8; 32] = att[112..144].try_into().unwrap();
    let att_root: [u8; 32] = att[144..176].try_into().unwrap();
    let att_batch = u64::from_be_bytes(att[176..184].try_into().unwrap());
    let att_nonce = u64::from_be_bytes(att[184..192].try_into().unwrap());
    let att_expiry = i64::from_be_bytes(att[192..200].try_into().unwrap());

    if auction_ai.owner != program_id || auction_ai.data_len() != STATE_LEN {
        return Err(EscrowError::UnknownAuction.into());
    }
    let state = {
        let data = auction_ai.try_borrow_data()?;
        load_state(&data)?
    };
    if att_auction != state.auction_id {
        return Err(EscrowError::BadBinding.into());
    }
    // cross-cluster / cross-deployment replay refusal: the signed message must carry this
    // cluster's genesis hash (pinned at lock) and this program's ID
    if att_genesis != state.genesis || att_program != program_id.as_ref() {
        return Err(EscrowError::BadBinding.into());
    }
    if state.refunded {
        return Err(EscrowError::Refunded.into());
    }
    if Clock::get()?.unix_timestamp > att_expiry {
        return Err(EscrowError::Expired.into());
    }
    // §10 item 2 (F-2): the attested release window must fit inside the refund-free window —
    // refund is allowed after `deadline`, so an expiry past it would let a refund race (and
    // capture) attested payouts still releasable until `expiry`. Signers attest expiry <= deadline.
    if att_expiry > state.deadline {
        return Err(EscrowError::BadParameters.into());
    }

    // the Approval PDA must be the account its seeds derive
    let (approval_pda, approval_bump) = Pubkey::find_program_address(
        &[b"approval", &state.auction_id, &att_batch.to_le_bytes()],
        program_id,
    );
    if approval_pda != *approval_ai.key {
        return Err(EscrowError::BadAccount.into());
    }
    // replay refusal (§10 item 3): `BatchReplayed` only when this program owns the account
    // with the APPROVAL_V1 marker — never from lamports or empty data: a dusted PDA must not
    // block the batch (the seller could dust it to escape settlement and take the full refund)
    if flag_is_set(approval_ai, program_id, APPROVAL_MARKER) {
        return Err(EscrowError::BatchReplayed.into());
    }

    // 2-of-3 Ed25519 via the preceding native verification instruction
    let current = load_current_index_checked(instructions_ai)? as usize;
    if current == 0 {
        return Err(EscrowError::BadEd25519.into());
    }
    let verify_ix = load_instruction_at_checked(current - 1, instructions_ai)?;
    if verify_ix.program_id != ed25519_program::ID {
        return Err(EscrowError::BadEd25519.into());
    }
    check_ed25519(&verify_ix.data, &state.signers, current)?;

    // write the Approval (crank pays rent; no transfers to recipients in this instruction).
    // Created pre-funding-safe (§10 item 3): a dusted PDA is topped up and completed with
    // allocate + assign instead of create_account
    create_flag(
        program_id,
        crank,
        approval_ai,
        system_program_ai,
        &[b"approval", &state.auction_id, &att_batch.to_le_bytes(), &[approval_bump]],
        APPROVAL_MARKER,
        APPROVAL_LEN,
    )?;
    let approval = Approval {
        auction_id: state.auction_id,
        batch_index: att_batch,
        allocation_root: att_root,
        result_hash: att_result,
        nonce: att_nonce,
        expiry: att_expiry,
        genesis: state.genesis,
        bump: approval_bump,
    };
    let mut data = approval_ai.try_borrow_mut_data()?;
    store_approval(&mut data, &approval)
}

/// `release_approved` (design §9): pay payouts against a verified `Approval`, with **no
/// signatures** — anyone (the crank) may call it repeatedly until every leaf is paid. Requires
/// `now <= approval.expiry` and the auction not refunded. Per payout: leaf bound and Merkle
/// membership against `approval.allocation_root` (the same leaf/root encoding), paid-flag PDA
/// unset, paid flag set before the transfer, cap (`paid + amount <= locked`) checked, then the
/// lamports move. Per-recipient failures skip and stay claimable (design §2.4): one failing
/// recipient never reverts the call.
fn release_approved(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    r: &mut Reader,
) -> ProgramResult {
    let iter = &mut accounts.iter();
    let crank = next_account_info(iter)?;
    let auction_ai = next_account_info(iter)?;
    let approval_ai = next_account_info(iter)?;
    let system_program_ai = next_account_info(iter)?;
    if !crank.is_signer || !crank.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if !auction_ai.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if system_program_ai.key != &solana_program::system_program::ID {
        return Err(EscrowError::BadAccount.into());
    }

    let npayload = r.u16()? as usize;
    if npayload == 0 || npayload > MAX_PAYOUTS {
        return Err(EscrowError::BadParameters.into());
    }
    let mut payouts = Vec::with_capacity(npayload);
    for _ in 0..npayload {
        let index = r.u64()?;
        let lot_count = r.u64()?;
        let destination_kind = r.u8()?;
        let destination = r.arr32()?;
        let leaf_count = r.u64()?;
        let proof_len = r.u16()? as usize;
        if proof_len > MAX_PROOF {
            return Err(EscrowError::BadParameters.into());
        }
        let mut proof = Vec::with_capacity(proof_len);
        for _ in 0..proof_len {
            proof.push(r.arr32()?);
        }
        payouts.push(Payout {
            index,
            lot_count,
            destination_kind,
            destination,
            leaf_count,
            proof,
        });
    }
    if !r.end() {
        return Err(EscrowError::BadInstruction.into());
    }

    if auction_ai.owner != program_id || auction_ai.data_len() != STATE_LEN {
        return Err(EscrowError::UnknownAuction.into());
    }
    let mut state = {
        let data = auction_ai.try_borrow_data()?;
        load_state(&data)?
    };
    // the Approval PDA (no signatures here: it was fully verified at submit_attestation)
    if approval_ai.owner != program_id || approval_ai.data_len() != APPROVAL_LEN {
        return Err(EscrowError::NoApproval.into());
    }
    let approval = {
        let data = approval_ai.try_borrow_data()?;
        load_approval(&data)?
    };
    // the approval account must be the PDA its own fields derive (self-binding)
    let (approval_pda, _) = Pubkey::find_program_address(
        &[b"approval", &approval.auction_id, &approval.batch_index.to_le_bytes()],
        program_id,
    );
    if approval_pda != *approval_ai.key {
        return Err(EscrowError::BadAccount.into());
    }
    if approval.auction_id != state.auction_id || approval.genesis != state.genesis {
        return Err(EscrowError::BadBinding.into());
    }
    if state.refunded {
        return Err(EscrowError::Refunded.into());
    }
    if Clock::get()?.unix_timestamp > approval.expiry {
        return Err(EscrowError::Expired.into());
    }

    // per-payout: verify the leaf against the approved root, pay at most once
    for p in payouts.iter() {
        let dest_ai = next_account_info(iter)?;
        let paid_ai = next_account_info(iter)?;
        if p.destination_kind != DEST_SOLANA || p.destination != dest_ai.key.to_bytes() {
            return Err(EscrowError::BadParameters.into());
        }
        if p.index >= p.leaf_count {
            return Err(EscrowError::LeafBound.into());
        }
        let leaf = leaf_hash(
            &state.auction_id,
            p.index,
            &ASSET_SOL,
            p.lot_count,
            p.destination_kind,
            &p.destination,
        );
        let mut tree_root = leaf;
        for node in &p.proof {
            tree_root = parent(&tree_root, node);
        }
        if root_hash(p.leaf_count, &tree_root) != approval.allocation_root {
            return Err(EscrowError::NotInRoot.into());
        }
        let (paid_pda, paid_bump) = Pubkey::find_program_address(
            &[b"paid", &state.auction_id, &leaf],
            program_id,
        );
        if paid_pda != *paid_ai.key {
            return Err(EscrowError::BadAccount.into());
        }

        // per-recipient paid flag (§10 item 1): a failing or already-paid recipient is skipped,
        // never a call revert; failed items stay claimable by a later release (design §2.4).
        // "Already paid" counts only if this program owns the flag account with the PAID_V1
        // marker — never from lamports or empty data: anyone can dust the predictable PDA with
        // lamports and fake "already paid" to permanently brick an attested payout.
        let mut skip = flag_is_set(paid_ai, program_id, PAID_MARKER);
        let amount = match p.lot_count.checked_mul(state.standard_lot) {
            Some(a) => a,
            None => {
                skip = true;
                0
            }
        };
        if state.paid.saturating_add(amount) > state.amount {
            skip = true; // over the locked cap: escrow never pays more than locked
        }
        if !dest_ai.is_writable || dest_ai.key == auction_ai.key {
            skip = true; // recipient cannot take the transfer right now
        }
        if skip {
            continue;
        }

        // effects before interactions (P0 ordering, mirrors the EVM contract): the paid flag is
        // written before any lamports move. On Solana the payout is a direct lamport debit/credit
        // of program-owned accounts — no CPI to the recipient, so no recipient code ever runs and
        // there is no callback vector here; the only CPI is to the system program (create/allocate
        // /assign/transfer), which cannot re-enter this program. The flag is written first anyway
        // so the ordering survives future edits (`state.paid` is persisted by `store_state` at the
        // end of this instruction; the transaction is atomic and no untrusted call sits in between).
        create_flag(
            program_id,
            crank,
            paid_ai,
            system_program_ai,
            &[b"paid", &state.auction_id, &leaf, &[paid_bump]],
            PAID_MARKER,
            PAID_LEN,
        )?;

        // move lamports out of the escrow PDA (program-owned) to the destination
        **auction_ai.try_borrow_mut_lamports()? -= amount;
        **dest_ai.try_borrow_mut_lamports()? += amount;
        state.paid += amount;
    }

    let mut data = auction_ai.try_borrow_mut_data()?;
    store_state(&mut data, &state)
}

/// Strict Ed25519 verification-instruction parse (design §1 traps). Signature and public-key
/// slices must live inside the verification instruction itself (`*_instruction_index == u16::MAX`);
/// the verified message must be exactly this submit-attestation instruction's attestation bytes (the one
/// cross-instruction location we accept: instruction index `current`, offset 2, size `ATT_LEN`).
/// Signature bytes were already verified by the native Ed25519 program (the whole transaction
/// fails otherwise); we re-check every offset and bound. Quorum: ≥ 2 distinct signer-set members.
fn check_ed25519(
    ix_data: &[u8],
    signers: &[[u8; 32]; 3],
    current: usize,
) -> ProgramResult {
    if ix_data.len() < 2 {
        return Err(EscrowError::BadEd25519.into());
    }
    let count = ix_data[0] as usize;
    if count < 2 || count > 3 {
        return Err(EscrowError::BadEd25519.into());
    }
    let header = 2 + 14 * count;
    if ix_data.len() < header {
        return Err(EscrowError::BadEd25519.into());
    }
    let mut first: Option<[u8; 32]> = None;
    let mut quorum = false;
    for i in 0..count {
        let o = 2 + 14 * i;
        let sig_off = u16::from_le_bytes(ix_data[o..o + 2].try_into().unwrap()) as usize;
        let sig_ix = u16::from_le_bytes(ix_data[o + 2..o + 4].try_into().unwrap());
        let pk_off = u16::from_le_bytes(ix_data[o + 4..o + 6].try_into().unwrap()) as usize;
        let pk_ix = u16::from_le_bytes(ix_data[o + 6..o + 8].try_into().unwrap());
        let msg_off = u16::from_le_bytes(ix_data[o + 8..o + 10].try_into().unwrap()) as usize;
        let msg_size = u16::from_le_bytes(ix_data[o + 10..o + 12].try_into().unwrap()) as usize;
        let msg_ix = u16::from_le_bytes(ix_data[o + 12..o + 14].try_into().unwrap());
        // strict offsets: sigs and pubkeys inside this instruction, message exactly at this
        // release instruction's attestation bytes and nowhere else
        if sig_ix != u16::MAX || pk_ix != u16::MAX {
            return Err(EscrowError::BadEd25519.into());
        }
        if msg_ix as usize != current || msg_off != 2 || msg_size != ATT_LEN {
            return Err(EscrowError::BadEd25519.into());
        }
        let sig_end = sig_off.checked_add(64).ok_or(EscrowError::BadEd25519)?;
        let pk_end = pk_off.checked_add(32).ok_or(EscrowError::BadEd25519)?;
        if sig_end > ix_data.len() || pk_end > ix_data.len() {
            return Err(EscrowError::BadEd25519.into());
        }
        let pk: [u8; 32] = ix_data[pk_off..pk_end].try_into().unwrap();
        if !signers.contains(&pk) {
            continue; // not a member: no quorum credit
        }
        match first {
            None => first = Some(pk),
            Some(f) if f != pk => quorum = true,
            _ => {}
        }
    }
    if !quorum {
        return Err(EscrowError::Quorum.into());
    }
    Ok(())
}

fn refund(program_id: &Pubkey, accounts: &[AccountInfo], r: &mut Reader) -> ProgramResult {
    let iter = &mut accounts.iter();
    let crank = next_account_info(iter)?;
    let auction_ai = next_account_info(iter)?;
    let return_ai = next_account_info(iter)?;
    if !crank.is_signer || !crank.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    if !auction_ai.is_writable || !return_ai.is_writable {
        return Err(EscrowError::BadAccount.into());
    }
    let auction_id = r.arr32()?;
    if !r.end() {
        return Err(EscrowError::BadInstruction.into());
    }

    if auction_ai.owner != program_id || auction_ai.data_len() != STATE_LEN {
        return Err(EscrowError::UnknownAuction.into());
    }
    let mut state = {
        let data = auction_ai.try_borrow_data()?;
        load_state(&data)?
    };
    if state.auction_id != auction_id {
        return Err(EscrowError::BadBinding.into());
    }
    if state.refunded {
        return Err(EscrowError::AlreadyRefunded.into());
    }
    if Clock::get()?.unix_timestamp <= state.deadline {
        return Err(EscrowError::BeforeDeadline.into());
    }
    if *return_ai.key != state.return_to {
        return Err(EscrowError::BadAccount.into());
    }

    // anyone may return the unspent remainder to the pinned return address (design §2.3)
    let remainder = state.amount - state.paid;
    **auction_ai.try_borrow_mut_lamports()? -= remainder;
    **return_ai.try_borrow_mut_lamports()? += remainder;
    state.refunded = true;
    let mut data = auction_ai.try_borrow_mut_data()?;
    store_state(&mut data, &state)
}
