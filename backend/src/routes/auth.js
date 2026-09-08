import { Router } from 'express';
import {
  authenticateCredentials,
  changeOwnPassword,
  enrichSession,
  requireAuth,
  signToken,
  updateOwnProfilePic,
} from '../auth.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const session = await authenticateCredentials(username, password);
    if (!session) return res.status(401).json({ error: 'Invalid username or password' });
    res.json({ token: signToken(session), session: await enrichSession(session) });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    res.json({ session: await enrichSession(req.session) });
  } catch (err) {
    next(err);
  }
});

authRouter.put('/me/profile-pic', requireAuth, async (req, res, next) => {
  try {
    const pic = req.body?.profile_pic ?? null;
    await updateOwnProfilePic(req.session, pic);
    res.json({ session: await enrichSession(req.session) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    await changeOwnPassword(req.session, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
