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

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const session = authenticateCredentials(username, password);
  if (!session) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token: signToken(session), session: enrichSession(session) });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ session: enrichSession(req.session) });
});

authRouter.put('/me/profile-pic', requireAuth, (req, res, next) => {
  try {
    const pic = req.body?.profile_pic ?? null;
    updateOwnProfilePic(req.session, pic);
    res.json({ session: enrichSession(req.session) });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/change-password', requireAuth, (req, res, next) => {
  const { currentPassword, newPassword } = req.body || {};
  try {
    changeOwnPassword(req.session, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
