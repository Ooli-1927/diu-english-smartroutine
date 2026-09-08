import { Router } from 'express';
import { bind, nowIso, updateOne } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  buildAuthUrl,
  callbackRedirect,
  canConnectGoogle,
  disconnectGoogle,
  getLinkStatus,
  handleOAuthCallback,
  isGoogleCalendarConfigured,
  syncUserRoutine,
  verifyOAuthState,
} from '../googleCalendar.js';

export const googleRouter = Router();

googleRouter.get('/status', requireAuth, async (req, res, next) => {
  try {
    if (!canConnectGoogle(req.session)) {
      return res.json({
        configured: isGoogleCalendarConfigured(),
        connected: false,
        allowed: false,
        email: null,
        lastSyncAt: null,
        lastSyncError: null,
      });
    }
    res.json({
      ...(await getLinkStatus(req.session.id)),
      allowed: true,
    });
  } catch (err) {
    next(err);
  }
});

/** Returns Google OAuth URL; JWT stays in Authorization header. */
googleRouter.post('/auth-url', requireAuth, (req, res, next) => {
  try {
    if (!isGoogleCalendarConfigured()) {
      return res.status(503).json({ error: 'Google Calendar is not configured on the server' });
    }
    if (!canConnectGoogle(req.session)) {
      return res.status(403).json({ error: 'Only students and teachers can connect Google Calendar' });
    }
    res.json({ url: buildAuthUrl(req.session) });
  } catch (err) {
    next(err);
  }
});

googleRouter.get('/callback', async (req, res) => {
  const statePayload = req.query.state ? verifyOAuthState(String(req.query.state)) : null;
  const roleFallback = statePayload?.role === 'student' ? 'student' : 'teacher';

  const fail = (msg) => {
    res.redirect(
      callbackRedirect(roleFallback, {
        google: 'error',
        message: String(msg).slice(0, 180),
      }),
    );
  };

  try {
    if (!isGoogleCalendarConfigured()) {
      return fail('not_configured');
    }
    if (req.query.error) {
      return fail(String(req.query.error));
    }
    const code = req.query.code;
    const state = req.query.state;
    if (!code || !state) {
      return fail('missing_code');
    }

    const { role } = await handleOAuthCallback(String(code), String(state));
    res.redirect(callbackRedirect(role, { google: 'connected' }));
  } catch (err) {
    console.warn('Google OAuth callback failed:', err?.message || err);
    fail(err?.message || 'connect_failed');
  }
});

googleRouter.post('/sync', requireAuth, async (req, res, next) => {
  try {
    if (!isGoogleCalendarConfigured()) {
      return res.status(503).json({ error: 'Google Calendar is not configured on the server' });
    }
    if (!canConnectGoogle(req.session)) {
      return res.status(403).json({ error: 'Only students and teachers can sync Google Calendar' });
    }
    const result = await syncUserRoutine(req.session.id);
    res.json({ ok: true, ...result, status: await getLinkStatus(req.session.id) });
  } catch (err) {
    try {
      await updateOne(
        'google_calendar_links',
        { user_id: req.session.id },
        {
          $set: {
            last_sync_error: bind(String(err?.message || err).slice(0, 500)),
            updated_at: nowIso(),
          },
        },
      );
    } catch {
      /* ignore */
    }
    next(err);
  }
});

googleRouter.delete('/disconnect', requireAuth, async (req, res, next) => {
  try {
    if (!canConnectGoogle(req.session)) {
      return res.status(403).json({ error: 'Not allowed' });
    }
    await disconnectGoogle(req.session.id);
    res.json({ ok: true, status: await getLinkStatus(req.session.id) });
  } catch (err) {
    next(err);
  }
});
