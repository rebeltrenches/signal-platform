/**
 * Real, session-authenticated alert CONFIGURATION endpoints only.
 * Create/list/delete an alert's settings — no triggering, no
 * scheduling, no notification delivery (see AlertRepository.ts's own
 * header for why that's out of scope for this stage). The owning
 * wallet comes only from a verified session token, same as
 * routes/watchlist.ts — never from a client-supplied field.
 */
import type { Handler } from '../router.js';
import { verifySessionToken } from '../auth/AuthSession.js';
import { createAlert, listAlerts, removeAlert, AlertValidationError, AlertUnauthorizedError } from '../alerts/alertStore.js';

function getSessionWallet(headers: Record<string, string | string[] | undefined>): string | null {
  const authHeader = headers.authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  const token = headerValue?.startsWith('Bearer ') ? headerValue.slice('Bearer '.length) : '';
  if (!token) return null;
  const payload = verifySessionToken(token);
  return payload?.address ?? null;
}

function errorToResponse(err: unknown): { status: number; body: unknown } {
  if (err instanceof AlertValidationError) return { status: 400, body: { error: 'VALIDATION_ERROR', message: err.message } };
  if (err instanceof AlertUnauthorizedError) return { status: 403, body: { error: 'UNAUTHORIZED', message: err.message } };
  console.error('[alerts] unexpected error:', err);
  return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'Something went wrong handling this alert request.' } };
}

export const getAlerts: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const alerts = await listAlerts(wallet);
  return { status: 200, body: { alerts } };
};

export const postAlert: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const alert = await createAlert(wallet, {
      tokenChain: typeof body.tokenChain === 'string' ? body.tokenChain.toUpperCase() : '',
      tokenAddress: typeof body.tokenAddress === 'string' ? body.tokenAddress : '',
      kind: body.kind as any,
      threshold: (body.threshold && typeof body.threshold === 'object' ? body.threshold : {}) as Record<string, unknown>,
    });
    return { status: 201, body: { alert } };
  } catch (err) {
    return errorToResponse(err);
  }
};

export const deleteAlert: Handler = async (req) => {
  const wallet = getSessionWallet(req.headers);
  if (!wallet) return { status: 401, body: { error: 'UNAUTHORIZED', message: 'A valid session is required.' } };
  const alertId = req.params.alertId ?? '';
  try {
    await removeAlert(wallet, alertId);
    return { status: 200, body: { removed: true } };
  } catch (err) {
    return errorToResponse(err);
  }
};
