use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    system_program,
    sysvar::{self, Sysvar},
};
use spl_associated_token_account::{
    get_associated_token_address_with_program_id,
    instruction::create_associated_token_account_idempotent,
};
use spl_token::{instruction as token_instruction, state::{Account as TokenAccount, Mint}};

entrypoint!(process_instruction);

// SIGNAL uses the classic Pump-style launch shape: virtual constant-product
// reserves provide price discovery immediately; 79.31% of supply is sold on
// the curve and 20.69% is reserved for the post-curve liquidity pool.
const INITIAL_REAL_TOKEN_BPS: u128 = 7_931;
const INITIAL_VIRTUAL_TOKEN_BPS: u128 = 10_730;
const BPS_DENOMINATOR: u128 = 10_000;
const INITIAL_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000; // 30 SOL
const SIGNAL_FEE_BPS: u128 = 100; // 1% of each Signal curve trade
const MINIMUM_TOKEN_SUPPLY_WHOLE: u64 = 100_000_000;
const STATE_LEN: usize = 160;
const STATE_VERSION: u8 = 2;

const INITIALIZE: u8 = 0;
const BUY_EXACT_SOL_IN: u8 = 1;
const SELL_EXACT_TOKENS_IN: u8 = 2;
const GRADUATE_TO_RAYDIUM: u8 = 3;

// Raydium CPMM Mainnet program and the current public index-0 config.
// The config's create_pool_fee is read from the account at graduation, not
// assumed from this source file, so a fee update cannot silently underfund it.
const RAYDIUM_CPMM_PROGRAM: Pubkey = Pubkey::new_from_array([
    169, 42, 90, 139, 79, 41, 89, 82, 132, 37, 80, 170, 147, 253, 91, 149,
    181, 172, 230, 168, 235, 146, 12, 147, 148, 46, 67, 105, 12, 32, 236, 115,
]);
const RAYDIUM_AMM_CONFIG: Pubkey = Pubkey::new_from_array([
    179, 33, 63, 186, 139, 249, 200, 127, 169, 30, 71, 129, 150, 40, 195, 131,
    224, 11, 234, 126, 152, 199, 160, 62, 3, 186, 16, 105, 207, 195, 246, 243,
]);
const RAYDIUM_CREATE_POOL_FEE: Pubkey = Pubkey::new_from_array([
    183, 208, 34, 82, 84, 172, 7, 227, 178, 189, 63, 134, 193, 240, 241, 16,
    63, 192, 112, 140, 193, 90, 239, 20, 7, 58, 166, 69, 63, 85, 234, 105,
]);
const WSOL_MINT: Pubkey = Pubkey::new_from_array([
    6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53,
    218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1,
]);

// Public SIGNAL treasury. Public key only; there is no private key here.
const PLATFORM_WALLET: Pubkey = Pubkey::new_from_array([
    242, 141, 105, 244, 163, 79, 113, 240, 153, 167, 134, 112, 39, 101, 29, 192,
    190, 235, 5, 149, 200, 253, 21, 46, 165, 2, 221, 180, 225, 179, 17, 99,
]);

// Current Raydium CPMM account sizes. They are validated against the public
// Raydium program source and are used only to fund the program-owned migration
// signer with exactly the rent that Raydium's initialize instruction needs.
const RAYDIUM_POOL_STATE_LEN: usize = 637;
const RAYDIUM_OBSERVATION_LEN: usize = 4_075;
const SPL_MINT_LEN: usize = 82;
const SPL_TOKEN_ACCOUNT_LEN: usize = 165;
const RAYDIUM_INITIALIZE_DISCRIMINATOR: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];

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
    graduation_pool: Pubkey,
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
            graduation_pool: key(117)?,
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
        data[117..149].copy_from_slice(self.graduation_pool.as_ref());
        Ok(())
    }
}

fn ceil_div(n: u128, d: u128) -> Result<u128, ProgramError> {
    if d == 0 { return Err(ProgramError::InvalidArgument); }
    Ok(n.checked_add(d - 1).ok_or(ProgramError::ArithmeticOverflow)? / d)
}

fn validate_initial_supply(total_supply: u64, decimals: u8) -> ProgramResult {
    if decimals > 9 { return Err(ProgramError::InvalidArgument); }
    let scale = 10u64.checked_pow(u32::from(decimals)).ok_or(ProgramError::ArithmeticOverflow)?;
    let minimum = MINIMUM_TOKEN_SUPPLY_WHOLE.checked_mul(scale).ok_or(ProgramError::ArithmeticOverflow)?;
    if total_supply < minimum { return Err(ProgramError::InvalidArgument); }
    Ok(())
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
    validate_initial_supply(total_supply, decimals)?;

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
        graduation_pool: Pubkey::default(),
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
    if token_out < min_tokens_out { return Err(ProgramError::Custom(1)); }
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

fn debit_owned_lamports(account: &AccountInfo, amount: u64, floor: u64) -> ProgramResult {
    let current = account.lamports();
    let next = current.checked_sub(amount).ok_or(ProgramError::InsufficientFunds)?;
    if next < floor { return Err(ProgramError::InsufficientFunds); }
    **account.try_borrow_mut_lamports()? = next;
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
    if seller_out < min_sol_out { return Err(ProgramError::Custom(1)); }
    let fee = gross.checked_sub(seller_out).ok_or(ProgramError::ArithmeticOverflow)?;

    invoke(
        &token_instruction::transfer(token_program.key, seller_token.key, curve_vault.key, seller.key, &[], token_in)?,
        &[seller_token.clone(), curve_vault.clone(), seller.clone(), token_program.clone()],
    )?;

    let rent_floor = Rent::get()?.minimum_balance(STATE_LEN);
    debit_owned_lamports(curve, gross, rent_floor)?;
    credit_lamports(seller, seller_out)?;
    credit_lamports(platform_wallet, fee)?;

    state.virtual_sol_reserves = state.virtual_sol_reserves.checked_sub(gross).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_sol_reserves = state.real_sol_reserves.checked_sub(gross).ok_or(ProgramError::ArithmeticOverflow)?;
    state.virtual_token_reserves = state.virtual_token_reserves.checked_add(token_in).ok_or(ProgramError::ArithmeticOverflow)?;
    state.real_token_reserves = state.real_token_reserves.checked_add(token_in).ok_or(ProgramError::ArithmeticOverflow)?;
    state.pack(&mut curve.try_borrow_mut_data()?)
}

fn raydium_create_pool_fee(amm_config: &AccountInfo) -> Result<u64, ProgramError> {
    if amm_config.key != &RAYDIUM_AMM_CONFIG || amm_config.owner != &RAYDIUM_CPMM_PROGRAM {
        return Err(ProgramError::InvalidAccountData);
    }
    let data = amm_config.try_borrow_data()?;
    if data.len() < 44 || data[9] != 0 { return Err(ProgramError::InvalidAccountData); }
    let bytes: [u8; 8] = data[36..44].try_into().map_err(|_| ProgramError::InvalidAccountData)?;
    Ok(u64::from_le_bytes(bytes))
}

fn account_needs_ata(account: &AccountInfo) -> Result<bool, ProgramError> {
    if account.owner == &spl_token::id() { return Ok(false); }
    if account.owner == &system_program::id() && account.data_is_empty() { return Ok(true); }
    Err(ProgramError::IllegalOwner)
}

fn create_migration_ata<'a>(
    migration_authority: &AccountInfo<'a>,
    ata: &AccountInfo<'a>,
    mint: &AccountInfo<'a>,
    token_program: &AccountInfo<'a>,
    associated_token_program: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    migration_seeds: &[&[u8]],
) -> ProgramResult {
    let ix = create_associated_token_account_idempotent(
        migration_authority.key,
        migration_authority.key,
        mint.key,
        token_program.key,
    );
    invoke_signed(
        &ix,
        &[
            migration_authority.clone(),
            ata.clone(),
            migration_authority.clone(),
            mint.clone(),
            system_program_info.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
        &[migration_seeds],
    )
}

fn raydium_initialize_data(amount_0: u64, amount_1: u64) -> Vec<u8> {
    let mut data = Vec::with_capacity(32);
    data.extend_from_slice(&RAYDIUM_INITIALIZE_DISCRIMINATOR);
    data.extend_from_slice(&amount_0.to_le_bytes());
    data.extend_from_slice(&amount_1.to_le_bytes());
    data.extend_from_slice(&0u64.to_le_bytes()); // open immediately
    data
}

fn graduation_setup_lamports(rent: &Rent, create_pool_fee: u64, token_ata_needed: bool, wsol_ata_needed: bool) -> Result<u64, ProgramError> {
    let mut total = create_pool_fee;
    for len in [RAYDIUM_POOL_STATE_LEN, SPL_MINT_LEN, SPL_TOKEN_ACCOUNT_LEN, SPL_TOKEN_ACCOUNT_LEN, SPL_TOKEN_ACCOUNT_LEN, RAYDIUM_OBSERVATION_LEN] {
        total = total.checked_add(rent.minimum_balance(len)).ok_or(ProgramError::ArithmeticOverflow)?;
    }
    if token_ata_needed { total = total.checked_add(rent.minimum_balance(SPL_TOKEN_ACCOUNT_LEN)).ok_or(ProgramError::ArithmeticOverflow)?; }
    if wsol_ata_needed { total = total.checked_add(rent.minimum_balance(SPL_TOKEN_ACCOUNT_LEN)).ok_or(ProgramError::ArithmeticOverflow)?; }
    Ok(total)
}

fn graduate(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let mut it = accounts.iter();
    let curve = next_account_info(&mut it)?;
    let mint = next_account_info(&mut it)?;
    let curve_vault = next_account_info(&mut it)?;
    let caller = next_account_info(&mut it)?;
    let migration_authority = next_account_info(&mut it)?;
    let migration_token = next_account_info(&mut it)?;
    let migration_wsol = next_account_info(&mut it)?;
    let wsol_mint = next_account_info(&mut it)?;
    let raydium_program = next_account_info(&mut it)?;
    let amm_config = next_account_info(&mut it)?;
    let raydium_authority = next_account_info(&mut it)?;
    let pool_state = next_account_info(&mut it)?;
    let lp_mint = next_account_info(&mut it)?;
    let creator_lp_token = next_account_info(&mut it)?;
    let pool_vault_0 = next_account_info(&mut it)?;
    let pool_vault_1 = next_account_info(&mut it)?;
    let create_pool_fee = next_account_info(&mut it)?;
    let observation_state = next_account_info(&mut it)?;
    let token_program = next_account_info(&mut it)?;
    let associated_token_program = next_account_info(&mut it)?;
    let system_program_info = next_account_info(&mut it)?;
    let rent_sysvar = next_account_info(&mut it)?;

    if !caller.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if token_program.key != &spl_token::id()
        || associated_token_program.key != &spl_associated_token_account::id()
        || system_program_info.key != &system_program::id()
        || rent_sysvar.key != &sysvar::rent::id()
        || raydium_program.key != &RAYDIUM_CPMM_PROGRAM
        || wsol_mint.key != &WSOL_MINT
        || wsol_mint.owner != token_program.key
        || create_pool_fee.key != &RAYDIUM_CREATE_POOL_FEE
        || create_pool_fee.owner != token_program.key
    {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut state = validate_curve_accounts(program_id, curve, mint, curve_vault, token_program)?;
    if !state.complete || state.graduated || state.real_token_reserves != 0 || state.real_sol_reserves == 0 {
        return Err(ProgramError::InvalidArgument);
    }

    let (expected_migration, migration_bump) = Pubkey::find_program_address(&[b"migration-authority", mint.key.as_ref()], program_id);
    if migration_authority.key != &expected_migration || migration_authority.owner != &system_program::id() || !migration_authority.data_is_empty() {
        return Err(ProgramError::InvalidSeeds);
    }
    let (expected_pool, pool_bump) = Pubkey::find_program_address(&[b"raydium-pool", mint.key.as_ref()], program_id);
    if pool_state.key != &expected_pool || pool_state.owner != &system_program::id() || !pool_state.data_is_empty() {
        return Err(ProgramError::InvalidSeeds);
    }

    let expected_token_ata = get_associated_token_address_with_program_id(&expected_migration, mint.key, token_program.key);
    let expected_wsol_ata = get_associated_token_address_with_program_id(&expected_migration, &WSOL_MINT, token_program.key);
    if migration_token.key != &expected_token_ata || migration_wsol.key != &expected_wsol_ata {
        return Err(ProgramError::InvalidAccountData);
    }
    let token_ata_needed = account_needs_ata(migration_token)?;
    let wsol_ata_needed = account_needs_ata(migration_wsol)?;

    let token0_is_mint = mint.key.to_bytes() < WSOL_MINT.to_bytes();
    let token_0 = if token0_is_mint { mint } else { wsol_mint };
    let token_1 = if token0_is_mint { wsol_mint } else { mint };
    let creator_token_0 = if token0_is_mint { migration_token } else { migration_wsol };
    let creator_token_1 = if token0_is_mint { migration_wsol } else { migration_token };

    let (expected_ray_authority, _) = Pubkey::find_program_address(&[b"vault_and_lp_mint_auth_seed"], &RAYDIUM_CPMM_PROGRAM);
    let (expected_lp_mint, _) = Pubkey::find_program_address(&[b"pool_lp_mint", pool_state.key.as_ref()], &RAYDIUM_CPMM_PROGRAM);
    let (expected_vault_0, _) = Pubkey::find_program_address(&[b"pool_vault", pool_state.key.as_ref(), token_0.key.as_ref()], &RAYDIUM_CPMM_PROGRAM);
    let (expected_vault_1, _) = Pubkey::find_program_address(&[b"pool_vault", pool_state.key.as_ref(), token_1.key.as_ref()], &RAYDIUM_CPMM_PROGRAM);
    let (expected_observation, _) = Pubkey::find_program_address(&[b"observation", pool_state.key.as_ref()], &RAYDIUM_CPMM_PROGRAM);
    let expected_lp_ata = get_associated_token_address_with_program_id(&expected_migration, &expected_lp_mint, token_program.key);
    if raydium_authority.key != &expected_ray_authority
        || lp_mint.key != &expected_lp_mint
        || creator_lp_token.key != &expected_lp_ata
        || pool_vault_0.key != &expected_vault_0
        || pool_vault_1.key != &expected_vault_1
        || observation_state.key != &expected_observation
    {
        return Err(ProgramError::InvalidSeeds);
    }

    let create_fee = raydium_create_pool_fee(amm_config)?;
    let rent = Rent::get()?;
    let setup = graduation_setup_lamports(&rent, create_fee, token_ata_needed, wsol_ata_needed)?;
    let existing_setup = migration_authority.lamports();
    let curve_funding = setup.saturating_sub(existing_setup);
    if curve_funding >= state.real_sol_reserves { return Err(ProgramError::InsufficientFunds); }
    let liquidity_sol = state.real_sol_reserves.checked_sub(curve_funding).ok_or(ProgramError::ArithmeticOverflow)?;
    if liquidity_sol == 0 { return Err(ProgramError::InsufficientFunds); }

    let curve_rent_floor = rent.minimum_balance(STATE_LEN);
    debit_owned_lamports(curve, curve_funding, curve_rent_floor)?;
    credit_lamports(migration_authority, curve_funding)?;

    let migration_bump_seed = [migration_bump];
    let migration_seeds: &[&[u8]] = &[b"migration-authority", mint.key.as_ref(), &migration_bump_seed];
    create_migration_ata(migration_authority, migration_token, mint, token_program, associated_token_program, system_program_info, migration_seeds)?;
    create_migration_ata(migration_authority, migration_wsol, wsol_mint, token_program, associated_token_program, system_program_info, migration_seeds)?;

    let token_ata_state = TokenAccount::unpack(&migration_token.try_borrow_data()?)?;
    let wsol_ata_state = TokenAccount::unpack(&migration_wsol.try_borrow_data()?)?;
    if token_ata_state.owner != expected_migration || token_ata_state.mint != *mint.key
        || wsol_ata_state.owner != expected_migration || wsol_ata_state.mint != WSOL_MINT
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let graduation_tokens = state.token_total_supply.checked_sub(state.initial_real_token_reserves)
        .ok_or(ProgramError::ArithmeticOverflow)?;
    let curve_vault_state = TokenAccount::unpack(&curve_vault.try_borrow_data()?)?;
    if curve_vault_state.amount < graduation_tokens { return Err(ProgramError::InsufficientFunds); }
    let curve_bump_seed = [state.bump];
    let curve_seeds: &[&[u8]] = &[b"bonding-curve", mint.key.as_ref(), &curve_bump_seed];
    invoke_signed(
        &token_instruction::transfer(token_program.key, curve_vault.key, migration_token.key, curve.key, &[], graduation_tokens)?,
        &[curve_vault.clone(), migration_token.clone(), curve.clone(), token_program.clone()],
        &[curve_seeds],
    )?;

    debit_owned_lamports(curve, liquidity_sol, curve_rent_floor)?;
    credit_lamports(migration_wsol, liquidity_sol)?;
    invoke(
        &token_instruction::sync_native(token_program.key, migration_wsol.key)?,
        &[migration_wsol.clone(), token_program.clone()],
    )?;

    let amount_0 = if token0_is_mint { graduation_tokens } else { liquidity_sol };
    let amount_1 = if token0_is_mint { liquidity_sol } else { graduation_tokens };
    let raydium_ix = Instruction {
        program_id: RAYDIUM_CPMM_PROGRAM,
        accounts: vec![
            AccountMeta::new(expected_migration, true),
            AccountMeta::new_readonly(RAYDIUM_AMM_CONFIG, false),
            AccountMeta::new_readonly(expected_ray_authority, false),
            AccountMeta::new(expected_pool, true),
            AccountMeta::new_readonly(*token_0.key, false),
            AccountMeta::new_readonly(*token_1.key, false),
            AccountMeta::new(expected_lp_mint, false),
            AccountMeta::new(*creator_token_0.key, false),
            AccountMeta::new(*creator_token_1.key, false),
            AccountMeta::new(expected_lp_ata, false),
            AccountMeta::new(expected_vault_0, false),
            AccountMeta::new(expected_vault_1, false),
            AccountMeta::new(RAYDIUM_CREATE_POOL_FEE, false),
            AccountMeta::new(expected_observation, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(spl_associated_token_account::id(), false),
            AccountMeta::new_readonly(system_program::id(), false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
        ],
        data: raydium_initialize_data(amount_0, amount_1),
    };
    let pool_bump_seed = [pool_bump];
    let pool_seeds: &[&[u8]] = &[b"raydium-pool", mint.key.as_ref(), &pool_bump_seed];
    invoke_signed(
        &raydium_ix,
        &[
            migration_authority.clone(), amm_config.clone(), raydium_authority.clone(), pool_state.clone(),
            token_0.clone(), token_1.clone(), lp_mint.clone(), creator_token_0.clone(), creator_token_1.clone(),
            creator_lp_token.clone(), pool_vault_0.clone(), pool_vault_1.clone(), create_pool_fee.clone(),
            observation_state.clone(), token_program.clone(), token_program.clone(), token_program.clone(),
            associated_token_program.clone(), system_program_info.clone(), rent_sysvar.clone(), raydium_program.clone(),
        ],
        &[migration_seeds, pool_seeds],
    )?;

    // Raydium mints LP tokens to its creator account (minus its permanently
    // locked minimum). Burn every LP token the Signal migration PDA receives,
    // making the migrated liquidity non-withdrawable by the creator, Signal,
    // or any human wallet.
    let lp_state = TokenAccount::unpack(&creator_lp_token.try_borrow_data()?)?;
    if lp_state.owner != expected_migration || lp_state.mint != expected_lp_mint || lp_state.amount == 0 {
        return Err(ProgramError::InvalidAccountData);
    }
    invoke_signed(
        &token_instruction::burn(token_program.key, creator_lp_token.key, lp_mint.key, migration_authority.key, &[], lp_state.amount)?,
        &[creator_lp_token.clone(), lp_mint.clone(), migration_authority.clone(), token_program.clone()],
        &[migration_seeds],
    )?;

    state.real_sol_reserves = 0;
    state.graduated = true;
    state.graduation_pool = expected_pool;
    state.pack(&mut curve.try_borrow_mut_data()?)
}

pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    match data.first().copied() {
        Some(INITIALIZE) => initialize(program_id, accounts, data),
        Some(BUY_EXACT_SOL_IN) => buy(program_id, accounts, data),
        Some(SELL_EXACT_TOKENS_IN) => sell(program_id, accounts, data),
        Some(GRADUATE_TO_RAYDIUM) if data.len() == 1 => graduate(program_id, accounts),
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
            graduation_pool: Pubkey::default(),
        }
    }

    #[test]
    fn minimum_supply_is_enforced_in_base_units() {
        assert!(validate_initial_supply(99_999_999, 0).is_err());
        assert!(validate_initial_supply(100_000_000, 0).is_ok());
        assert!(validate_initial_supply(99_999_999_999_999, 6).is_err());
        assert!(validate_initial_supply(100_000_000_000_000, 6).is_ok());
        assert!(validate_initial_supply(100_000_000_000_000_000, 9).is_ok());
        assert!(validate_initial_supply(100_000_000_000_000_000, 10).is_err());
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
        validate_initial_supply(supply, 6).unwrap();
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
        assert!(seller_out < 1_000_000_000);
    }

    #[test]
    fn state_pack_round_trip_includes_graduation_pool() {
        let mut original = state();
        original.graduation_pool = Pubkey::new_unique();
        let mut bytes = [0u8; STATE_LEN];
        original.pack(&mut bytes).unwrap();
        assert_eq!(CurveState::unpack(&bytes).unwrap(), original);
    }

    #[test]
    fn graduation_budget_is_create_fee_plus_exact_rents() {
        let rent = Rent::default();
        let create_fee = 150_000_000;
        let full = graduation_setup_lamports(&rent, create_fee, true, true).unwrap();
        let precreated = graduation_setup_lamports(&rent, create_fee, false, false).unwrap();
        assert_eq!(full - precreated, 2 * rent.minimum_balance(SPL_TOKEN_ACCOUNT_LEN));
        assert!(precreated > create_fee);
    }

    #[test]
    fn raydium_initialize_payload_is_anchor_discriminator_plus_three_u64s() {
        let payload = raydium_initialize_data(11, 22);
        assert_eq!(&payload[..8], &RAYDIUM_INITIALIZE_DISCRIMINATOR);
        assert_eq!(payload.len(), 32);
        assert_eq!(u64::from_le_bytes(payload[8..16].try_into().unwrap()), 11);
        assert_eq!(u64::from_le_bytes(payload[16..24].try_into().unwrap()), 22);
        assert_eq!(u64::from_le_bytes(payload[24..32].try_into().unwrap()), 0);
    }
}