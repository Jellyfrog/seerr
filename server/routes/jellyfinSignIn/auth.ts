import { ApiErrorCode } from '@server/constants/error';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import {
  clientIp,
  isJellyfinSignInEnabled,
  jellyfinClient,
  jellyfinDeviceId,
} from '@server/lib/jellyfinSignIn';
import logger from '@server/logger';
import { quickConnectSecret } from '@server/routes/auth';
import { ApiError } from '@server/types/error';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

/**
 * Jellyfin sign-in for a Plex media server, mounted at `/auth` ahead of
 * upstream's routes. Every handler steps aside unless Plex is the media server
 * and Jellyfin sign-in is enabled, so upstream keeps handling (and, on a Plex
 * server, rejecting) everything else.
 */
const jellyfinSignInAuthRoutes = Router();

const onlyWhenEnabled = (_req: Request, _res: Response, next: NextFunction) =>
  isJellyfinSignInEnabled() ? next() : next('router');

/** Signs the linked user in, or refuses: accounts are never created here. */
const signInLinkedUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
  account: { User: { Id: string; Name: string }; AccessToken: string },
  deviceId: string
) => {
  const userRepository = getRepository(User);
  const user = await userRepository.findOne({
    where: { jellyfinUserId: account.User.Id },
  });

  if (!user) {
    logger.warn(
      'Failed sign-in attempt by Jellyfin user without a linked Seerr account',
      {
        label: 'API',
        ip: req.ip,
        jellyfinUserId: account.User.Id,
        jellyfinUsername: account.User.Name,
      }
    );
    return next({ status: 403, message: 'Access denied.' });
  }

  // Only refresh what Jellyfin owns; the user's type, avatar and email belong
  // to their Plex identity.
  user.jellyfinUsername = account.User.Name;
  user.jellyfinAuthToken = account.AccessToken;
  user.jellyfinDeviceId = deviceId;
  await userRepository.save(user);

  if (req.session) {
    req.session.userId = user.id;
  }

  return res.status(200).json(user.filter());
};

jellyfinSignInAuthRoutes.get('/jellyfin/secondary', (_req, res) => {
  return res.status(200).json({ enabled: isJellyfinSignInEnabled() });
});

jellyfinSignInAuthRoutes.post(
  '/jellyfin',
  onlyWhenEnabled,
  async (req, res, next) => {
    const body = req.body as { username?: string; password?: string };

    if (!body.username) {
      return res.status(500).json({ error: 'You must provide an username' });
    }

    try {
      const existing = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect('user.jellyfinDeviceId')
        .where('user.jellyfinUsername = :username', {
          username: body.username,
        })
        .getOne();
      const deviceId =
        existing?.jellyfinDeviceId ?? jellyfinDeviceId(body.username);

      const account = await jellyfinClient(deviceId).login(
        body.username,
        body.password,
        clientIp(req)
      );

      return await signInLinkedUser(req, res, next, account, deviceId);
    } catch (e) {
      if (e instanceof ApiError) {
        logger.warn('Failed Jellyfin sign-in attempt', {
          label: 'Auth',
          ip: req.ip,
          error: e.errorCode,
        });
        return next({ status: e.statusCode, message: e.errorCode });
      }

      logger.error(e.message, { label: 'Auth' });
      return next({ status: 500, message: 'Something went wrong.' });
    }
  }
);

jellyfinSignInAuthRoutes.post(
  '/jellyfin/quickconnect/initiate',
  onlyWhenEnabled,
  async (_req, res, next) => {
    try {
      const response = await jellyfinClient().initiateQuickConnect();

      return res.status(200).json({
        code: response.Code,
        secret: response.Secret,
      });
    } catch (e) {
      logger.error('Error initiating Jellyfin quick connect', {
        label: 'Auth',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Failed to initiate quick connect.',
      });
    }
  }
);

jellyfinSignInAuthRoutes.get(
  '/jellyfin/quickconnect/check',
  onlyWhenEnabled,
  async (req, res, next) => {
    const result = quickConnectSecret.safeParse(req.query);
    if (!result.success) {
      return next({ status: 400, message: 'Invalid secret format' });
    }

    try {
      const response = await jellyfinClient().checkQuickConnect(
        result.data.secret
      );

      return res.status(200).json({ authenticated: response.Authenticated });
    } catch (e) {
      return next({
        status: e.statusCode || 500,
        message: 'Failed to check Quick Connect status',
      });
    }
  }
);

jellyfinSignInAuthRoutes.post(
  '/jellyfin/quickconnect/authenticate',
  onlyWhenEnabled,
  async (req, res, next) => {
    const result = quickConnectSecret.safeParse(req.body);
    if (!result.success) {
      return next({ status: 400, message: 'Secret required' });
    }

    try {
      const account = await jellyfinClient().authenticateQuickConnect(
        result.data.secret
      );

      return await signInLinkedUser(
        req,
        res,
        next,
        account,
        jellyfinDeviceId(account.User.Name ?? '')
      );
    } catch (e) {
      logger.error('Error authenticating Jellyfin quick connect', {
        label: 'Auth',
        errorMessage: e.message,
      });
      return next({
        status: e.statusCode || 500,
        message:
          e instanceof ApiError &&
          e.errorCode === ApiErrorCode.InvalidCredentials
            ? e.errorCode
            : 'Quick Connect authentication failed.',
      });
    }
  }
);

export default jellyfinSignInAuthRoutes;
