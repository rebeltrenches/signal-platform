import type { Handler } from '../router.js';
import { computeTaxSplit, InvalidTaxConfigError } from '@launchpad/utils';
import { DEFAULT_TAX_CONFIG, type TaxConfig } from '@launchpad/types';

/**
 * Real computation, not a stub — wired directly to the same
 * computeTaxSplit() that has 9 passing tests. Lets the frontend (or you,
 * with curl) preview the exact Signal Fee breakdown for an amount
 * before any wallet ever gets a signing prompt, per spec section 7's
 * "always show fee before confirmation" requirement.
 *
 * Current model: 100% of the 1% transfer fee goes to the token creator.
 * `creatorTax` and `totalTax` are therefore equal in this response.
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
