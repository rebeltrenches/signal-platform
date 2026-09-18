# apps/web — Stage 4, not started

Planned: Next.js frontend. Reuses the dark, high-density visual language
already established in the earlier single-chain build ("Signal") as a
starting point rather than a from-scratch redesign — same information
density and dark-first look the spec section 22 asks for, evolved for
multi-chain and the new pages (Launch Radar, token pages, wallet pages,
creator profiles) this bigger spec adds.

Routes this stage needs to stand up (content comes in later stages):
`/`, `/create`, `/token/[chain]/[address]`, `/wallet/[chain]/[address]`,
`/creator/[address]`, `/watchlist`, `/security`, `/admin`.
