use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    system_program,
    sysvar::{rent::Rent, Sysvar},
};
use solana_program::program_pack::Pack;
use spl_token::{instruction::close_account, state::{Account as TokenAccount, Mint}};

entrypoint!(process_instruction);

const CREATOR_FEE_BPS: u64 = 100;
const BPS_DENOMINATOR: u64 = 10_000;
const SETTLE_SELL: u8 = 1;

fn split_creator_fee(gross: u64) -> Result<(u64, u64), ProgramError> {
    if gross == 0 { return Err(ProgramError::InsufficientFunds); }
    let creator_fee = gross.checked_mul(CREATOR_FEE_BPS)
        .ok_or(ProgramError::ArithmeticOverflow)? / BPS_DENOMINATOR;
    if creator_fee == 0 { return Err(ProgramError::InvalidArgument); }
    let trader_amount = gross.checked_sub(creator_fee).ok_or(ProgramError::ArithmeticOverflow)?;
    Ok((creator_fee, trader_amount))
}

/// Accounts:
/// 0 authority PDA (writable; receives unwrapped SOL temporarily)
/// 1 trade-specific WSOL settlement account (writable)
/// 2 permanent replay-receipt PDA (writable)
/// 3 creator wallet (writable)
/// 4 trader wallet (signer, writable)
/// 5 canonical WSOL mint
/// 6 SPL Token program
/// 7 System program
///
/// The client creates the trade-specific settlement ATA non-idempotently in the
/// same atomic transaction before the Raydium swap. On settlement, this program
/// creates a permanent program-owned receipt PDA keyed by trader + creator +
/// trade ID. A consumed trade ID therefore cannot be reused after the temporary
/// WSOL account is closed.
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 33 || data[0] != SETTLE_SELL {
        return Err(ProgramError::InvalidInstructionData);
    }
    let trade_id = &data[1..33];

    let mut it = accounts.iter();
    let authority = next_account_info(&mut it)?;
    let settlement = next_account_info(&mut it)?;
    let receipt = next_account_info(&mut it)?;
    let creator_wallet = next_account_info(&mut it)?;
    let trader_wallet = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system_program_info = next_account_info(&mut it)?;

    if !trader_wallet.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if token_program.key != &spl_token::id() || mint.key != &spl_token::native_mint::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    if system_program_info.key != &system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }

    let (expected_authority, bump) = Pubkey::find_program_address(
        &[b"sell-settlement", trader_wallet.key.as_ref(), creator_wallet.key.as_ref(), trade_id],
        program_id,
    );
    if authority.key != &expected_authority {
        return Err(ProgramError::InvalidSeeds);
    }
    if settlement.key != &spl_associated_token_account::get_associated_token_address_with_program_id(
        &expected_authority,
        &spl_token::native_mint::id(),
        &spl_token::id(),
    ) {
        return Err(ProgramError::InvalidAccountData);
    }

    let (expected_receipt, receipt_bump) = Pubkey::find_program_address(
        &[b"sell-receipt", trader_wallet.key.as_ref(), creator_wallet.key.as_ref(), trade_id],
        program_id,
    );
    if receipt.key != &expected_receipt {
        return Err(ProgramError::InvalidSeeds);
    }
    if receipt.owner != &system_program::id() || !receipt.data_is_empty() || receipt.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let receipt_bump_seed = [receipt_bump];
    let receipt_seeds: &[&[u8]] = &[
        b"sell-receipt",
        trader_wallet.key.as_ref(),
        creator_wallet.key.as_ref(),
        trade_id,
        &receipt_bump_seed,
    ];
    let receipt_lamports = Rent::get()?.minimum_balance(1);
    invoke_signed(
        &system_instruction::create_account(
            trader_wallet.key,
            receipt.key,
            receipt_lamports,
            1,
            program_id,
        ),
        &[trader_wallet.clone(), receipt.clone(), system_program_info.clone()],
        &[receipt_seeds],
    )?;
    receipt.try_borrow_mut_data()?[0] = SETTLE_SELL;

    if authority.owner != &system_program::id() || !authority.data_is_empty() {
        return Err(ProgramError::IllegalOwner);
    }
    if settlement.owner != token_program.key {
        return Err(ProgramError::IllegalOwner);
    }

    let mint_state = Mint::unpack(&mint.try_borrow_data()?)?;
    if mint_state.decimals != 9 {
        return Err(ProgramError::InvalidAccountData);
    }
    let settlement_state = TokenAccount::unpack(&settlement.try_borrow_data()?)?;
    if settlement_state.owner != expected_authority || settlement_state.mint != *mint.key {
        return Err(ProgramError::InvalidAccountData);
    }
    if settlement_state.is_native.is_none() {
        return Err(ProgramError::InvalidAccountData);
    }

    let gross = settlement_state.amount;
    let (creator_fee, trader_amount) = split_creator_fee(gross)?;

    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[
        b"sell-settlement", trader_wallet.key.as_ref(), creator_wallet.key.as_ref(), trade_id, &bump_seed,
    ];

    invoke_signed(
        &close_account(token_program.key, settlement.key, authority.key, authority.key, &[])?,
        &[settlement.clone(), authority.clone(), authority.clone(), token_program.clone()],
        &[seeds],
    )?;

    invoke_signed(
        &system_instruction::transfer(authority.key, creator_wallet.key, creator_fee),
        &[authority.clone(), creator_wallet.clone(), system_program_info.clone()],
        &[seeds],
    )?;
    invoke_signed(
        &system_instruction::transfer(authority.key, trader_wallet.key, trader_amount),
        &[authority.clone(), trader_wallet.clone(), system_program_info.clone()],
        &[seeds],
    )?;

    let remainder = authority.lamports();
    if remainder > 0 {
        invoke_signed(
            &system_instruction::transfer(authority.key, trader_wallet.key, remainder),
            &[authority.clone(), trader_wallet.clone(), system_program_info.clone()],
            &[seeds],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_one_sol_exactly() {
        let (creator, trader) = split_creator_fee(1_000_000_000).unwrap();
        assert_eq!(creator, 10_000_000);
        assert_eq!(trader, 990_000_000);
    }

    #[test]
    fn rejects_amount_below_one_creator_lamport() {
        assert!(split_creator_fee(99).is_err());
    }

    #[test]
    fn preserves_every_lamport_in_split() {
        let gross = 1_234_567_890;
        let (creator, trader) = split_creator_fee(gross).unwrap();
        assert_eq!(creator + trader, gross);
    }
}
