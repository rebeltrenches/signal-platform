import type { Handler } from '../router.js';
import {
  getLaunchByTokenId, getLaunchById, listLaunches,
  LaunchValidationError, LaunchNotFoundError, type LaunchStatus,
} from '../launches/launchStore.js';

const VALID_STATUSES: LaunchStatus[] = ['DRAFT', 'BONDING', 'GRADUATED', 'FAILED'];

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof LaunchValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  if (err instanceof LaunchNotFoundError) return { status: 404, body: { error: 'NOT_FOUND', message: err.message } };
  console.error('[launches] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this launch request.' } };
}

export const listLaunchesRoute: Handler = async (req) => {
  const rawStatus = req.query.get('status');
  if (rawStatus && !VALID_STATUSES.includes(rawStatus as LaunchStatus)) {
    return { status: 400, body: { error: 'VALIDATION_ERROR', message: `status must be one of: ${VALID_STATUSES.join(', ')}` } };
  }
  try {
    const launches = await listLaunches(rawStatus as LaunchStatus | undefined);
    return { status: 200, body: { launches } };
  } catch (err) { return errorToResponse(err); }
};

export const getLaunchRoute: Handler = async (req) => {
  try {
    const launch = await getLaunchById(req.params.launchId ?? '');
    if (!launch) return { status: 404, body: { error: 'NOT_FOUND', message: 'No launch found with this id.' } };
    return { status: 200, body: { launch } };
  } catch (err) { return errorToResponse(err); }
};

export const getLaunchByTokenRoute: Handler = async (req) => {
  try {
    const launch = await getLaunchByTokenId(req.params.tokenId ?? '');
    if (!launch) return { status: 404, body: { error: 'NOT_FOUND', message: 'No launch found for this token.' } };
    return { status: 200, body: { launch } };
  } catch (err) { return errorToResponse(err); }
};
