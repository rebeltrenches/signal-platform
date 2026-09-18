# apps/api — Stage 3, not started

Planned: versioned REST API. Route list from the spec (section 35),
kept here so Stage 3 starts from this list rather than re-deriving it:

/api/v1/tokens
/api/v1/tokens/[chain]/[address]
/api/v1/launches
/api/v1/trades
/api/v1/holders
/api/v1/wallets
/api/v1/creators
/api/v1/analytics
/api/v1/watchlist
/api/v1/alerts
/api/v1/search
/api/v1/chains
/api/v1/rewards
/api/v1/tax

Every route handler talks to chains only through `@launchpad/blockchain`
and `@launchpad/dex`'s adapter interfaces — never a chain SDK directly.
Request/response validation via Zod (or equivalent), per spec section 46.
