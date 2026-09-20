/**
 * Shared by PrismaChatRepository and PrismaTokenRepository — both need
 * "find or create the Wallet row for this address" and nothing more
 * specific than that, so this is factored out once rather than kept as
 * two copies that could quietly drift apart. Takes only the narrow
 * `wallet` slice of a client, not a full PrismaLikeClient, so either
 * repository's own (larger) client interface satisfies this
 * structurally with no extra wiring.
 */
export interface WalletCapableClient {
  wallet: {
    findUnique(args: any): Promise<any>;
    create(args: any): Promise<any>;
  };
}

/**
 * A stricter client shape for ensureUserForWallet below — only the
 * repositories that actually need a linked User row (Chat's
 * reportMessage, and now Watchlist/Alert, whose schema models point at
 * User directly rather than Wallet) need this; PrismaTokenRepository
 * doesn't (Token.creatorId points at Wallet, not User), so it stays on
 * the narrower WalletCapableClient above rather than being forced to
 * carry unused wallet.update/user.create methods in its own mock.
 */
export interface UserCapableClient extends WalletCapableClient {
  wallet: WalletCapableClient['wallet'] & {
    update(args: any): Promise<any>;
  };
  user: {
    create(args: any): Promise<any>;
  };
}

const SOLANA = 'SOLANA';

export async function ensureWallet(
  db: WalletCapableClient,
  address: string
): Promise<{ id: string; userId: string | null }> {
  const existing = await db.wallet.findUnique({ where: { address_chain: { address, chain: SOLANA } } });
  if (existing) return existing;
  try {
    return await db.wallet.create({ data: { address, chain: SOLANA } });
  } catch {
    // Lost a create race — the row exists now, read it.
    const retried = await db.wallet.findUnique({ where: { address_chain: { address, chain: SOLANA } } });
    if (!retried) throw new Error('Could not create or find wallet record.');
    return retried;
  }
}

/**
 * Resolves a wallet address to a real User id, creating both the
 * Wallet and the User (and linking them) on first use if needed.
 * Extracted here after PrismaChatRepository had its own private copy
 * of exactly this logic — factored out once Watchlist/Alert needed
 * the identical thing a third time, same reasoning as ensureWallet's
 * own extraction above.
 */
export async function ensureUserForWallet(db: UserCapableClient, address: string): Promise<string> {
  const wallet = await ensureWallet(db, address);
  if (wallet.userId) return wallet.userId;
  const user = await db.user.create({ data: {} });
  // Persist the link — without this, every call for the same wallet
  // creates a NEW User (this exact bug was caught by a real test when
  // this logic first existed, privately, in PrismaChatRepository: it
  // broke report idempotency, since lookups keyed on reporterId, which
  // would silently differ on every call otherwise).
  await db.wallet.update({ where: { id: wallet.id }, data: { userId: user.id } });
  return user.id;
}
