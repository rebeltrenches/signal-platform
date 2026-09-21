use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use spl_token::{instruction::transfer_checked, state::{Account as TokenAccount, Mint}};
use solana_program::program_pack::Pack;

entrypoint!(process_instruction);

const CREATOR_FEE_BPS: u64 = 100;
const BPS_DENOMINATOR: u64 = 10_000;

/// Settlement accounts:
/// 0. settlement authority PDA
/// 1. program-controlled WSOL token account
/// 2. creator WSOL token account
/// 3. trader WSOL token account
/// 4. WSOL mint
/// 5. SPL Token program
///
/// This first implementation splits the WSOL present in the settlement account.
/// It MUST NOT be enabled for production until transaction orchestration proves
/// the account starts empty for each trade (or a baseline/delta state is added).
/// Otherwise a pre-existing balance could be included in the split. The authority
/// is a PDA; no private platform signing key is used.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut it = accounts.iter();
    let authority = next_account_info(&mut it)?;
    let settlement = next_account_info(&mut it)?;
    let creator = next_account_info(&mut it)?;
    let trader = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;

    if token_program.key != &spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_authority, bump) = Pubkey::find_program_address(&[b"sell-settlement"], program_id);
    if authority.key != &expected_authority {
        return Err(ProgramError::InvalidSeeds);
    }

    let mint_state = Mint::unpack(&mint.try_borrow_data()?)?;
    if mint_state.decimals != 9 {
        return Err(ProgramError::InvalidAccountData);
    }

    let settlement_state = TokenAccount::unpack(&settlement.try_borrow_data()?)?;
    if settlement_state.owner != expected_authority || settlement_state.mint != *mint.key {
        return Err(ProgramError::InvalidAccountData);
    }

    let creator_state = TokenAccount::unpack(&creator.try_borrow_data()?)?;
    let trader_state = TokenAccount::unpack(&trader.try_borrow_data()?)?;
    if creator_state.mint != *mint.key || trader_state.mint != *mint.key {
        return Err(ProgramError::InvalidAccountData);
    }

    let gross = settlement_state.amount;
    if gross == 0 {
        return Err(ProgramError::InsufficientFunds);
    }
    let creator_fee = gross
        .checked_mul(CREATOR_FEE_BPS).ok_or(ProgramError::ArithmeticOverflow)?
        / BPS_DENOMINATOR;
    if creator_fee == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    let trader_amount = gross.checked_sub(creator_fee).ok_or(ProgramError::ArithmeticOverflow)?;

    let seeds: &[&[u8]] = &[b"sell-settlement", &[bump]];
    invoke_signed(
        &transfer_checked(
            token_program.key, settlement.key, mint.key, creator.key,
            authority.key, &[], creator_fee, mint_state.decimals,
        )?,
        &[settlement.clone(), mint.clone(), creator.clone(), authority.clone(), token_program.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &transfer_checked(
            token_program.key, settlement.key, mint.key, trader.key,
            authority.key, &[], trader_amount, mint_state.decimals,
        )?,
        &[settlement.clone(), mint.clone(), trader.clone(), authority.clone(), token_program.clone()],
        &[seeds],
    )?;

    Ok(())
}
