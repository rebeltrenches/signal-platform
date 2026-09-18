# contracts/evm — deliberately empty

Per ADR-0003 (see docs/ARCHITECTURE.md): Base and BNB Chain launch with
trading/discovery only, no transaction tax, until a custom tax contract
is written and professionally audited. Writing a custom ERC-20 tax
contract without an audit is the exact risk pattern this project avoided
on Solana by using Token-2022 instead of hand-rolled code — doing it
here without the same rigor would undermine that decision. This
directory stays empty until that audit budget and process exist.
