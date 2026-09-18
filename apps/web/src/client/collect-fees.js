// Real Solana fee-collection flow — the execution side of the gap
// identified during QA: SolanaAdapter.buildHarvestAndWithdrawTransactions
// existed as correct instruction-building logic but was never reachable
// by an actual user. This file is a faithful port of that exact logic
// (same instructions, same batch size, same idempotent-ATA pattern, same
// authority) into browser-executable form — mirroring it rather than
// duplicating a different design, the same way launch-solana.js already
// mirrors SolanaAdapter.buildCreateTokenTransaction. Never executed
// against a real network from this sandbox — no internet access here.
//
// Model, unchanged: 3% total Transfer Fee, 100% to the connected
// creator wallet. No Signal fee, no holder-rewards pool, no split — this
// file introduces no new destination of any kind. The ONLY wallet that
// can ever receive anything here is whichever wallet is connected when
// "Collect Fees" is clicked, and only for a mint whose recorded
// creatorAddress already matches that wallet (enforced in dashboard.js,
// which decides whether the button exists at all).
import * as web3 from "https://esm.sh/@solana/web3.js@1.95.3";
import * as splToken from "https://esm.sh/@solana/spl-token@0.4.9?deps=@solana/web3.js@1.95.3";

const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const HARVEST_BATCH_SIZE = 20; // matches SolanaAdapter.ts exactly

function explorerLink(signature) {
  return `https://explorer.solana.com/tx/${signature}`;
}

class CollectFeesFlow {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
  }

  /** Mirrors SolanaAdapter.buildHarvestAndWithdrawTransactions's scan
   *  step exactly: real getProgramAccounts + getTransferFeeAmount, no
   *  invented data. Returns the real list of accounts that actually
   *  have a withheld balance right now. */
  async scanWithheldAccounts(mint) {
    const allAccounts = await this.connection.getProgramAccounts(splToken.TOKEN_2022_PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
    });
    return allAccounts
      .map(({ pubkey, account }) => {
        const unpacked = splToken.unpackAccount(pubkey, account, splToken.TOKEN_2022_PROGRAM_ID);
        const feeAmount = splToken.getTransferFeeAmount(unpacked);
        return { pubkey, withheld: feeAmount ? feeAmount.withheldAmount : 0n };
      })
      .filter((a) => a.withheld > 0n);
  }

  /** One real signed+submitted+confirmed transaction — no simulated
   *  states, every transition below reflects an actual awaited promise. */
  async signSubmitConfirm(tx, onState) {
    onState("awaiting_signature");
    const signed = await this.wallet.signTransaction(tx);
    onState("submitted");
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    onState("confirming");
    const confirmation = await this.connection.confirmTransaction(signature, "confirmed");
    if (confirmation.value.err) {
      onState("failed");
      throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    onState("confirmed");
    return signature;
  }

  /**
   * The full lifecycle, real: harvest withheld amounts from every
   * eligible account into the mint (permissionless, batched — matches
   * SolanaAdapter's HARVEST_BATCH_SIZE), then withdraw the mint's
   * accumulated balance to the creator's own token account (requires
   * withdrawWithheldAuthority — the connected wallet, since that's who
   * SolanaAdapter set as the authority at creation time).
   *
   * Returns a real, honest result:
   *  - { collected: false } if nothing was withheld anywhere — no
   *    transaction is built or sent in this case, matching
   *    SolanaAdapter's corrected (2026-09-17) no-fees behavior exactly.
   *  - { collected: true, signatures, destinationAta } after a real
   *    confirmed withdrawal.
   * Throws on any real failure — never swallowed into a false success.
   */
  async collect(mintAddress, creatorPubkey, decimals, onStepState) {
    const mint = new web3.PublicKey(mintAddress);

    const accountsWithFees = await this.scanWithheldAccounts(mint);
    if (accountsWithFees.length === 0) {
      return { collected: false };
    }

    const signatures = [];
    const { blockhash } = await this.connection.getLatestBlockhash();

    for (let i = 0; i < accountsWithFees.length; i += HARVEST_BATCH_SIZE) {
      const batch = accountsWithFees.slice(i, i + HARVEST_BATCH_SIZE).map((a) => a.pubkey);
      const harvestTx = new web3.Transaction().add(
        splToken.createHarvestWithheldTokensToMintInstruction(mint, batch, splToken.TOKEN_2022_PROGRAM_ID)
      );
      harvestTx.recentBlockhash = blockhash;
      harvestTx.feePayer = creatorPubkey;
      const sig = await this.signSubmitConfirm(harvestTx, (s) => onStepState("harvest", s));
      signatures.push(sig);
    }

    const ata = splToken.getAssociatedTokenAddressSync(mint, creatorPubkey, false, splToken.TOKEN_2022_PROGRAM_ID);
    const withdrawTx = new web3.Transaction().add(
      splToken.createAssociatedTokenAccountIdempotentInstruction(
        creatorPubkey,
        ata,
        creatorPubkey,
        mint,
        splToken.TOKEN_2022_PROGRAM_ID
      ),
      splToken.createWithdrawWithheldTokensFromMintInstruction(
        mint,
        ata,
        creatorPubkey,
        [],
        splToken.TOKEN_2022_PROGRAM_ID
      )
    );
    withdrawTx.recentBlockhash = blockhash;
    withdrawTx.feePayer = creatorPubkey;
    const withdrawSig = await this.signSubmitConfirm(withdrawTx, (s) => onStepState("withdraw", s));
    signatures.push(withdrawSig);

    return { collected: true, signatures, destinationAta: ata.toBase58() };
  }
}

(function () {
  const listEl = document.getElementById('launches-list');
  if (!listEl) return; // not on the Dashboard page

  // Event delegation: buttons are rendered dynamically by dashboard.js,
  // re-created on every render() call, so listeners attached at load
  // time would go stale. Listening on the stable parent avoids that.
  listEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-collect-mint]');
    if (!btn) return;

    const mintAddress = btn.getAttribute('data-collect-mint');
    const decimals = Number(btn.getAttribute('data-decimals') || '6');
    const card = btn.closest('[data-launch-card]');
    const statusEl = card ? card.querySelector('[data-collect-status]') : null;

    if (!window.solana || !window.solana.isPhantom) {
      if (statusEl) statusEl.textContent = 'Phantom not found.';
      return;
    }

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Checking…';
    if (statusEl) statusEl.textContent = '';

    try {
      const resp = await window.solana.connect();
      const creatorPubkey = new web3.PublicKey(resp.publicKey.toString());

      // Authorization is enforced twice, deliberately: dashboard.js
      // already only renders this button for a matching creatorAddress,
      // and this is the second, independent check right before signing
      // — if the connected wallet has changed since the button was
      // rendered, this catches it rather than trusting stale DOM state.
      const launches = JSON.parse(localStorage.getItem('signal_real_launches_v1') || '[]');
      const record = launches.find((l) => l.mint === mintAddress);
      if (!record || record.creatorAddress !== creatorPubkey.toBase58()) {
        btn.textContent = originalLabel;
        btn.disabled = false;
        if (statusEl) statusEl.textContent = 'This wallet did not launch this token — nothing to collect.';
        return;
      }

      const connection = new web3.Connection(MAINNET_RPC, 'confirmed');
      const flow = new CollectFeesFlow(connection, window.solana);

      const result = await flow.collect(mintAddress, creatorPubkey, decimals, (step, state) => {
        btn.textContent = step === 'harvest' ? `Harvesting (${state})…` : `Withdrawing (${state})…`;
      });

      if (!result.collected) {
        btn.textContent = originalLabel;
        btn.disabled = false;
        if (statusEl) statusEl.textContent = 'No fees to collect yet — nothing withheld for this token right now.';
        return;
      }

      btn.textContent = 'Collected';
      if (statusEl) {
        const links = result.signatures
          .map((sig, i) => `<a href="${explorerLink(sig)}" target="_blank">${i === result.signatures.length - 1 ? 'withdrawal' : 'harvest'} tx</a>`)
          .join(', ');
        statusEl.innerHTML = `Collected to ${result.destinationAta.slice(0, 4)}\u2026${result.destinationAta.slice(-4)} — ${links}`;
      }
    } catch (err) {
      btn.textContent = originalLabel;
      btn.disabled = false;
      if (statusEl) statusEl.textContent = `Failed: ${err.message}`;
    }
  });
})();
