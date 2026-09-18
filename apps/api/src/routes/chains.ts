import type { Handler } from '../router.js';
import { CHAIN_CONFIGS } from '@launchpad/config';

/** Real data — reads straight from the same config the rest of the app
 *  uses, no mock/fixture layer. */
export const listChains: Handler = () => ({
  status: 200,
  body: {
    chains: Object.values(CHAIN_CONFIGS).map((c) => ({
      chain: c.chain,
      displayName: c.displayName,
      family: c.family,
      adapterImplemented: c.adapterImplemented,
      taxSupported: c.taxSupported,
      isTestnet: c.isTestnet,
    })),
  },
});
