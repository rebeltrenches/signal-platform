use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    system_instruction,
    system_program,
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
/// 2 creator wallet (writable)
/// 3 trader wallet (signer, writable)
/// 4 canonical WSOL mint
/// 5 SPL Token program
/// 6 System program
///
/// The client must create the trade-specific settlement ATA with a NON-idempotent
/// create instruction in the same atomic transaction before the Raydium swap.
/// That makes an already-existing/pre-funded settlement account fail the transaction.
/// Raydium then sends WSOL to it and this instruction closes/unwraps it and splits
/// only its native WSOL amount: 1% creator, 99% trader. Rent reclaimed by closing
/// the temporary token account is returned to the trader.
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 33 || data[0] != SETTLE_SELL {
        return Err(ProgramError::InvalidInstructionData);
    }
    let trade_id = &data[1..33];

    let mut it = accounts.iter();
    let authority = next_account_info(&mut it)?;
    let settlement = next_account_info(&mut it)?;
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

    // Closing a native WSOL account unwraps its SOL and returns all lamports
    // (WSOL backing + rent) to the authority PDA.
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

    // Return the temporary token-account rent (and only any harmless donated
    // lamports at this unique PDA) to the trader so no SOL remains trapped.
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
