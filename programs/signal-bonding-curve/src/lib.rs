use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::Sysvar,
};
use spl_token::{instruction as token_instruction, state::{Account as TokenAccount, Mint}};

entrypoint!(process_instruction);

// SIGNAL follows the same launch shape as Pump's classic curve: virtual
// constant-product reserves provide price discovery from the first trade,
// 79.31% of supply is available on the bonding curve, and the remaining
// 20.69% stays in the program-owned vault for post-curve liquidity.
// The ratios scale with any supported total supply; the initial market-cap
// shape therefore stays consistent even when a creator chooses 100M, 1B, etc.
const INITIAL_REAL_TOKEN_BPS: u128 = 7_931;
const INITIAL_VIRTUAL_TOKEN_BPS: u128 = 10_730;
const BPS_DENOMINATOR: u128 = 10_000;
const INITIAL_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000; // 30 SOL
const SIGNAL_FEE_BPS: u128 = 100; // 1% of each curve trade
const STATE_LEN: usize = 128;
const STATE_VERSION: u8 = 1;

const INITIALIZE: u8 = 0;
const BUY_EXACT_SOL_IN: u8 = 1;
const SELL_EXACT_TOKENS_IN: u8 = 2;

// Public SIGNAL treasury. Public key only; there is no private key here.
const PLATFORM_WALLET: Pubkey = Pubkey::new_from_array([
    242, 141, 105, 244, 163, 79, 113, 240,
    153, 167, 134, 112, 39, 101, 29, 192,
    190, 235, 5, 149, 200, 253, 21, 46,
    165, 2, 221, 180, 225, 179, 17, 99,
]);

#[derive(Clone, Debug, PartialEq)]
struct CurveState {
    bump: u8,
    complete: bool,
    graduated: bool,
    mint: Pubkey,
    creator: Pubkey,
    virtual_token_reserves: u64,
    virtual_sol_reserves: u64,
    real_token_reserves: u64,
    real_sol_reserves: u64,
    token_total_supply: u64,
    initial_real_token_reserves: u64,
    decimals: u8,
}

impl CurveState {
    fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != STATE_LEN || data[0] != STATE_VERSION {
            return Err(ProgramError::InvalidAccountData);
        }
        let key = |start: usize| -> Result<Pubkey, ProgramError> {
            let bytes: [u8; 32] = data[start..start + 32]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?;
            Ok(Pubkey::new_from_array(bytes))
        };
        let u64_at = |start: usize| -> Result<u64, ProgramError> {
            let bytes: [u8; 8] = data[start..start + 8]
                .try_into()
                .map_err(|_| ProgramError::InvalidAccountData)?;
            Ok(u64::from_le_bytes(bytes))
        };
        Ok(Self {
            bump: data[1],
            complete: data[2] != 0,
            graduated: data[3] != 0,
            mint: key(4)?,
            creator: key(36)?,
            virtual_token_reserves: u64_at(68)?,
            virtual_sol_reserves: u64_at(76)?,
            real_token_reserves: u64_at(84)?,
            real_sol_reserves: u64_at(92)?,
            token_total_supply: u64_at(100)?,
            initial_real_token_reserves: u64_at(108)?,
            decimals: data[116],
        })
    }

    fn pack(&self, data: &mut [u8]) -> ProgramResult {
        if data.len() != STATE_LEN { return Err(ProgramError::InvalidAccountData); }
        data.fill(0);
        data[0] = STATE_VERSION;
        data[1] = self.bump;
        data[2] = u8::from(self.complete);
        data[3] = u8::from(self.graduated);
        data[4..36].copy_from_slice(self.mint.as_ref());
        data[36..68].copy_from_slice(self.creator.as_ref());
        data[68..76].copy_from_slice(&self.virtual_token_reserves.to_le_bytes());
        data[76..84].copy_from_slice(&self.virtual_sol_reserves.to_le_bytes());
        data[84..92].copy_from_slice(&self.real_token_reserves.to_le_bytes());
        data[92..100].copy_from_slice(&self.real_sol_reserves.to_le_bytes());
        data[100..108].copy_from_slice(&self.token_total_supply.to_le_bytes());
        data[108..116].copy_from_slice(&self.initial_real_token_reserves.to_le_bytes());
        data[116] = self.decimals;
        Ok(())
    }
}

fn ceil_div(n: u128, d: u128) -> Result<u128, ProgramError> {
    if d == 0 { return Err(ProgramError::InvalidArgument); }
    Ok(n.checked_add(d - 1).ok_or(ProgramError::ArithmeticOverflow)? / d)
}

fn initial_reserves(total_supply: u64) -> Result<(u64, u64), ProgramError> {
    let total = u128::from(total_supply);
    let real = total.checked_mul(INITIAL_REAL_TOKEN_BPS)
        .ok_or(ProgramError::ArithmeticOverflow)? / BPS_DENOMINATOR;
    let virtual_tokens = total.checked_mul(INITIAL_VIRTUAL_TOKEN_BPS)
        .ok_or(ProgramError::ArithmeticOverflow)? / BPS_DENOMINATOR;
    if real == 0 || virtual_tokens <= real || virtual_tokens > u128::from(u64::MAX) {
        return Err(ProgramError::InvalidArgument);
    }
    Ok((real as u64, virtual_tokens as u64))
}

fn trade_fee(amount: u64) -> Result<u64, ProgramError> {
    let fee = u128::from(amount).checked_mul(SIGNAL_FEE_BPS)
        .ok_or(ProgramError::ArithmeticOverflow)? / BPS_DENOMINATOR;
    u64::try_from(fee).map_err(|_| ProgramError::ArithmeticOverflow)
}

fn final_fill_fee(net_amount: u64) -> Result<u64, ProgramError> {
    let fee = ceil_div(
        u128::from(net_amount).checked_mul(SIGNAL_FEE_BPS)
            .ok_or(ProgramError::ArithmeticOverflow)?,
        BPS_DENOMINATOR - SIGNAL_FEE_BPS,
    )?;
    u64::try_from(fee).map_err(|_| ProgramError::ArithmeticOverflow)
}

fn quote_buy(state: &CurveState, max_gross_lamports: u64) -> Result<(u64, u64, u64), ProgramError> {
    if state.complete || state.graduated || max_gross_lamports == 0 {
        return Err(ProgramError::InvalidArgument);
    }
    let max_fee = trade_fee(max_gross_lamports)?;
    if max_fee == 0 || max_fee >= max_gross_lamports { return Err(ProgramError::InvalidArgument); }
    let max_net = max_gross_lamports - max_fee;
    let k = u128::from(state.virtual_token_reserves)
        .checked_mul(u128::from(state.virtual_sol_reserves))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let max_new_sol = u128::from(state.virtual_sol_reserves)
        .checked_add(u128::from(max_net)).ok_or(ProgramError::ArithmeticOverflow)?;
    let max_new_tokens = ceil_div(k, max_new_sol)?;
    if max_new_tokens >= u128::from(state.virtual_token_reserves) {
        return Err(ProgramError::InvalidArgument);
    }
    let theoretical_out = u128::from(state.virtual_token_reserves) - max_new_tokens;

    if theoretical_out <= u128::from(state.real_token_reserves) {
        let token_out = u64::try_from(theoretical_out).map_err(|_| ProgramError::ArithmeticOverflow)?;
        if token_out == 0 { return Err(ProgramError::InvalidArgument); }
        return Ok((max_gross_lamports, max_net, token_out));
    }

    // Last buy: only charge the SOL actually required to buy the remaining
    // real curve inventory. The caller's max is a cap, never an amount we
    // silently overcharge when the curve is almost complete.
    let token_out = state.real_token_reserves;
    let target_virtual_tokens = state.virtual_token_reserves
        .checked_sub(token_out).ok_or(ProgramError::ArithmeticOverflow)?;
    if target_virtual_tokens == 0 { return Err(ProgramError::InvalidArgument); }
    let required_new_virtual_sol = ceil_div(k, u128::from(target_virtual_tokens))?;
    if required_new_virtual_sol <= u128::from(state.virtual_sol_reserves) {
        return Err(ProgramError::InvalidArgument);
    }
    let required_net = u64::try_from(required_new_virtual_sol - u128::from(state.virtual_sol_reserves))
        .map_err(|_| ProgramError::ArithmeticOverflow)?;
    let fee = final_fill_fee(required_net)?;
    let gross = required_net.checked_add(fee).ok_or(ProgramError::ArithmeticOverflow)?;
    if gross > max_gross_lamports { return Err(ProgramError::InsufficientFunds); }
    Ok((gross, required_net, token_out))
}

fn quote_sell(state: &CurveState, token_in: u64) -> Result<(u64, u64), ProgramError> {
    if state.complete || state.graduated || token_in == 0 { return Err(ProgramError::InvalidArgument); }
    let new_real_tokens = state.real_token_reserves.checked_add(token_in)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    if new_real_tokens > state.initial_real_token_reserves { return Err(ProgramError::InvalidArgument); }
    let k = u128::from(state.virtual_token_reserves)
        .checked_mul(u128::from(state.virtual_sol_reserves))
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let new_virtual_tokens = u128::from(state.virtual_token_reserves)
        .checked_add(u128::from(token_in)).ok_or(ProgramError::ArithmeticOverflow)?;
    let new_virtual_sol = ceil_div(k, new_virtual_tokens)?;
    if new_virtual_sol >= u128::from(state.virtual_sol_reserves) { return Err(ProgramError::InvalidArgument); }
    let gross = u64::try_from(u128::from(state.virtual_sol_reserves) - new_virtual_sol)
        .map_err(|_| ProgramError::ArithmeticOverflow)?;
    if gross == 0 || gross > state.real_sol_reserves { return Err(ProgramError::InsufficientFunds); }
    let fee = trade_fee(gross)?;
    if fee == 0 || fee >= gross { return Err(ProgramError::InvalidArgument); }
    Ok((gross, gross - fee))
}

fn read_u64(data: &[u8], start: usize) -> Result<u64, ProgramError> {
    let bytes: [u8; 8] = data.get(start..start + 8)
        .ok_or(ProgramError::InvalidInstructionData)?
        .try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
    Ok(u64::from_le_bytes(bytes))
}

fn validate_curve_accounts<'a>(
    program_id: &Pubkey,
    curve: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    curve_vault: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
) -> Result<CurveState, ProgramError> {
    if curve.owner != program_id || mint.owner != token_program.key || token_program.key != &spl_token::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let state = CurveState::unpack(&curve.try_borrow_data()?)?;
    if &state.mint != mint.key { return Err(ProgramError::InvalidAccountData); }
    let (expected_curve, expected_bump) = Pubkey::find_program_address(&[b"bonding-curve", mint.key.as_ref()], program_id);
    if curve.key != &expected_curve || state.bump != expected_bump { return Err(ProgramError::InvalidSeeds); }
    if curve_vault.owner != token_program.key { return Err(ProgramError::IllegalOwner); }
    let vault = TokenAccount::unpack(&curve_vault.try_borrow_data()?)?;
    if vault.owner != expected_curve || vault.mint != *mint.key { return Err(ProgramError::InvalidAccountData); }
    Ok(state)
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 10 { return Err(ProgramError::InvalidInstructionData); }
    let total_supply = read_u64(data, 1)?;
    let decimals = data[9];
    if total_supply == 0 || decimals > 9 { return Err(ProgramError::InvalidArgument); }

    let mut it = accounts.iter();
    let curve = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let curve_vault = next_account_info(&mut it)?;
    let creator = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system_program_info = next_account_info(&mut it)?;

    if !creator.is_signer || !creator.is_writable { return Err(ProgramError::MissingRequiredSignature); }
    if token_program.key != &spl_token::id() || mint.owner != token_program.key || system_program_info.key != &system_program::id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected_curve, bump) = Pubkey::find_program_address(&[b"bonding-curve", mint.key.as_ref()], program_id);
    if curve.key != &expected_curve { return Err(ProgramError::InvalidSeeds); }
    if curve.owner != &system_program::id() || !curve.data_is_empty() || curve.lamports() != 0 {
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    let mint_state = Mint::unpack(&mint.try_borrow_data()?)?;
    if mint_state.decimals != decimals || mint_state.supply != total_supply || mint_state.mint_authority.is_some() || mint_state.freeze_authority.is_some() {
        return Err(ProgramError::InvalidAccountData);
    }
    if curve_vault.owner != token_program.key { return Err(ProgramError::IllegalOwner); }
    let vault = TokenAccount::unpack(&curve_vault.try_borrow_data()?)?;
    if vault.owner != expected_curve || vault.mint != *mint.key || vault.amount != total_supply {
        return Err(ProgramError::InvalidAccountData);
    }

    let (real_tokens, virtual_tokens) = initial_reserves(total_supply)?;
    let rent = Rent::get()?.minimum_balance(STATE_LEN);
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[b"bonding-curve", mint.key.as_ref(), &bump_seed];
    invoke_signed(
        &system_instruction::create_account(creator.key, curve.key, rent, STATE_LEN as u64, program_id),
        &[creator.clone(), curve.clone(), system_program_info.clone()],
        &[seeds],
    )?;

    CurveState {
        bump,
        complete: false,
        graduated: false,
        mint: *mint.key,
        creator: *creator.key,
        virtual_token_reserves: virtual_tokens,
        virtual_sol_reserves: INITIAL_VIRTUAL_SOL_RESERVES,
        real_token_reserves: real_tokens,
        real_sol_reserves: 0,
        token_total_supply: total_supply,
        initial_real_token_reserves: real_tokens,
        decimals,
    }.pack(&mut curve.try_borrow_mut_data()?)
}

fn buy(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 17 { return Err(ProgramError::InvalidInstructionData); }
    let max_gross = read_u64(data, 1)?;
    let min_tokens_out = read_u64(data, 9)?;

    let mut it = accounts.iter();
    let curve = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let curve_vault = next_account_info(&mut it)?;
    let buyer_token = next_account_info(&mut it)?;
    let buyer = next_account_info(&mut it)?;
    let platform_wallet = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let system_program_info = next_account_info(&mut it)?;

    if !buyer.is_signer || !buyer.is_writable { return Err(ProgramError::MissingRequiredSignature); }
    if platform_wallet.key != &PLATFORM_WALLET || !platform_wallet.is_writable || system_program_info.key != &system_program::id() {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut state = validate_curve_accounts(program_id, curve, mint, curve_vault, token_program)?;
    if buyer_token.owner != token_program.key { return Err(ProgramError::IllegalOwner); }
    let buyer_token_state = TokenAccount::unpack(&buyer_token.try_borrow_data()?)?;
    if buyer_token_state.owner != *buyer.key || buyer_token_state.mint != *mint.key { return Err(ProgramError::InvalidAccountData); }

    let (gross, net, token_out) = quote_buy(&state, max_gross)?;
    if token_out < min_tokens_out { return Err(ProgramError::Custom(1)); } // slippage
    let fee = gross.checked_sub(net).ok_or(ProgramError::ArithmeticOverflow)?;

    invoke(&system_instruction::transfer(buyer.key, curve.key, net), &[buyer.clone(), curve.clone(), system_program_info.clone()])?;
    invoke(&system_instruction::transfer(buyer.key, platform_wallet.key, fee), &[buyer.clone(), platform_wallet.clone(), system_program_info.clone()])?;

    let bump_seed = [state.bump];
    let seeds: &[&[u8]] = &[b"bonding-curve", mint.key.as_ref(), &bump_seed];
    invoke_signed(
        &token_instruction::transfer(token_program.key, curve_vault.key, buyer_token.key, curve.key, &[], token_out)?,
        &[curve_vault.clone(), buyer_token.clone(), curve.clone(), token_program.clone()],
        &[seeds],
    )?;

    state.virtual_sol_reserves = state.virtual_sol_reserves.checked_add(net).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_sol_reserves = state.real_sol_reserves.checked_add(net).ok_or(ProgramError::ArithmeticOverflow)?;
    state.virtual_token_reserves = state.virtual_token_reserves.checked_sub(token_out).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_token_reserves = state.real_token_reserves.checked_sub(token_out).ok_or(ProgramError::ArithmeticOverflow)?;
    if state.real_token_reserves == 0 { state.complete = true; }
    state.pack(&mut curve.try_borrow_mut_data()?)
}

fn credit_lamports(account: &AccountInfo, amount: u64) -> ProgramResult {
    let current = account.lamports();
    **account.try_borrow_mut_lamports()? = current.checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
    Ok(())
}

fn sell(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if data.len() != 17 { return Err(ProgramError::InvalidInstructionData); }
    let token_in = read_u64(data, 1)?;
    let min_sol_out = read_u64(data, 9)?;

    let mut it = accounts.iter();
    let curve = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let curve_vault = next_account_info(&mut it)?;
    let seller_token = next_account_info(&mut it)?;
    let seller = next_account_info(&mut it)?;
    let platform_wallet = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;

    if !seller.is_signer || !seller.is_writable { return Err(ProgramError::MissingRequiredSignature); }
    if platform_wallet.key != &PLATFORM_WALLET || !platform_wallet.is_writable { return Err(ProgramError::InvalidAccountData); }
    let mut state = validate_curve_accounts(program_id, curve, mint, curve_vault, token_program)?;
    if seller_token.owner != token_program.key { return Err(ProgramError::IllegalOwner); }
    let seller_token_state = TokenAccount::unpack(&seller_token.try_borrow_data()?)?;
    if seller_token_state.owner != *seller.key || seller_token_state.mint != *mint.key || seller_token_state.amount < token_in {
        return Err(ProgramError::InvalidAccountData);
    }

    let (gross, seller_out) = quote_sell(&state, token_in)?;
    if seller_out < min_sol_out { return Err(ProgramError::Custom(1)); } // slippage
    let fee = gross.checked_sub(seller_out).ok_or(ProgramError::ArithmeticOverflow)?;

    invoke(
        &token_instruction::transfer(token_program.key, seller_token.key, curve_vault.key, seller.key, &[], token_in)?,
        &[seller_token.clone(), curve_vault.clone(), seller.clone(), token_program.clone()],
    )?;

    let before = curve.lamports();
    let rent_floor = Rent::get()?.minimum_balance(STATE_LEN);
    let after = before.checked_sub(gross).ok_or(ProgramError::InsufficientFunds)?;
    if after < rent_floor { return Err(ProgramError::InsufficientFunds); }
    **curve.try_borrow_mut_lamports()? = after;
    credit_lamports(seller, seller_out)?;
    credit_lamports(platform_wallet, fee)?;

    state.virtual_sol_reserves = state.virtual_sol_reserves.checked_sub(gross).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_sol_reserves = state.real_sol_reserves.checked_sub(gross).ok_or(ProgramError::ArithmeticOverflow)?;
    state.virtual_token_reserves = state.virtual_token_reserves.checked_add(token_in).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_token_reserves = state.real_token_reserves.checked_add(token_in).ok_or(ProgramError::ArithmeticOverflow)?;
    state.pack(&mut curve.try_borrow_mut_data()?)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    match data.first().copied() {
        Some(INITIALIZE) => initialize(program_id, accounts, data),
        Some(BUY_EXACT_SOL_IN) => buy(program_id, accounts, data),
        Some(SELL_EXACT_TOKENS_IN) => sell(program_id, accounts, data),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> CurveState {
        let supply = 1_000_000_000_000_000u64; // 1B at 6 decimals
        let (real, virtual_tokens) = initial_reserves(supply).unwrap();
        CurveState {
            bump: 255,
            complete: false,
            graduated: false,
            mint: Pubkey::new_unique(),
            creator: Pubkey::new_unique(),
            virtual_token_reserves: virtual_tokens,
            virtual_sol_reserves: INITIAL_VIRTUAL_SOL_RESERVES,
            real_token_reserves: real,
            real_sol_reserves: 0,
            token_total_supply: supply,
            initial_real_token_reserves: real,
            decimals: 6,
        }
    }

    #[test]
    fn matches_classic_pump_shape_for_one_billion_supply() {
        let s = state();
        assert_eq!(s.virtual_token_reserves, 1_073_000_000_000_000);
        assert_eq!(s.real_token_reserves, 793_100_000_000_000);
        assert_eq!(s.virtual_sol_reserves, 30_000_000_000);
        assert_eq!(s.token_total_supply - s.real_token_reserves, 206_900_000_000_000);
    }

    #[test]
    fn curve_shape_scales_to_signal_minimum_supply() {
        let supply = 100_000_000_000_000u64; // 100M at 6 decimals
        let (real, virtual_tokens) = initial_reserves(supply).unwrap();
        assert_eq!(real, 79_310_000_000_000);
        assert_eq!(virtual_tokens, 107_300_000_000_000);
    }

    #[test]
    fn one_tenth_sol_buy_moves_price_up_and_keeps_fee_separate() {
        let s = state();
        let (gross, net, out) = quote_buy(&s, 100_000_000).unwrap();
        assert_eq!(gross, 100_000_000);
        assert_eq!(net, 99_000_000);
        assert!(out > 0);
        let old_price_num = u128::from(s.virtual_sol_reserves) * 1_000_000_000u128 / u128::from(s.virtual_token_reserves);
        let new_price_num = u128::from(s.virtual_sol_reserves + net) * 1_000_000_000u128 / u128::from(s.virtual_token_reserves - out);
        assert!(new_price_num >= old_price_num);
    }

    #[test]
    fn final_buy_never_charges_more_than_needed() {
        let mut s = state();
        s.real_token_reserves = 1_000;
        let (gross, _net, out) = quote_buy(&s, 10_000_000_000).unwrap();
        assert_eq!(out, 1_000);
        assert!(gross < 10_000_000_000);
    }

    #[test]
    fn sell_cannot_put_more_real_tokens_back_than_curve_started_with() {
        let s = state();
        assert!(quote_sell(&s, 1).is_err());
    }

    #[test]
    fn buy_then_sell_round_trip_is_bounded_and_curve_backed() {
        let mut s = state();
        let (_gross, net, out) = quote_buy(&s, 1_000_000_000).unwrap();
        s.virtual_sol_reserves += net;
        s.real_sol_reserves += net;
        s.virtual_token_reserves -= out;
        s.real_token_reserves -= out;
        let (gross_sell, seller_out) = quote_sell(&s, out).unwrap();
        assert!(gross_sell <= s.real_sol_reserves);
        assert!(seller_out < 1_000_000_000); // fees prevent a free round trip
    }

    #[test]
    fn state_pack_round_trip() {
        let original = state();
        let mut bytes = [0u8; STATE_LEN];
        original.pack(&mut bytes).unwrap();
        assert_eq!(CurveState::unpack(&bytes).unwrap(), original);
    }
}
