import type { Handler } from '../router.js';

export const getHealth: Handler = () => ({
  status: 200,
  body: { status: 'ok', service: 'api', timestamp: new Date().toISOString() },
});

/** Honest by construction: there is no database connection configured or
 *  attempted in this sandbox, so this reports 'not_configured', never a
 *  faked 'ok' — same DataPoint-style honesty as the rest of the app. */
export const getHealthDatabase: Handler = () => ({
  status: 503,
  body: {
    status: 'not_configured',
    message: 'No DATABASE_URL connection attempted in this environment (no live Postgres here).',
  },
});
