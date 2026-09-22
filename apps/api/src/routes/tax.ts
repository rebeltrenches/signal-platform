import type { Handler } from '../router.js';
import { computeTaxSplit, InvalidTaxConfigError } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG, type TaxConfig } from '@launchpad/types';

/**
 * Legacy-named preview endpoint for the creator trading-fee math.
 * The current fee is 1% of the SOL side of SIGNAL-routed trades and belongs
 * entirely to the token creator. This endpoint performs integer math only;
 * it does not imply an arbitrary token-transfer fee.
 */
export const previewTax: Handler = (req) => {
  const body = (req.body ?? {}) as { amount?: string; taxConfig?: Partial<TaxConfig> };

  if (!body.amount || !/^\d+$/.test(body.amount)) {
    return {
      status: 400,
      body: { error: 'INVALID_AMOUNT', message: 'Provide `amount` as a string of digits (base units).' },
    };
  }

  const config: TaxConfig = { ...DEFAULT_TAX_CONFIG, ...body.taxConfig };

  try {
    const split = computeTaxSplit(BigInt(body.amount), config);
    return {
      status: 200,
      body: {
        grossAmount: split.grossAmount,
        totalTax: split.totalTax,
        creatorTax: split.creatorTax, // 100% of totalTax — the token creator
        netAmount: split.netAmount,
        config,
      },
    };
  } catch (err) {
    if (err instanceof InvalidTaxConfigError) {
      return { status: 422, body: { error: 'INVALID_TAX_CONFIG', message: err.message } };
    }
    throw err;
  }
};
