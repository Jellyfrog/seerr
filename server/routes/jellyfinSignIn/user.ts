import { ApiErrorCode } from '@server/constants/error';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import {
  clientIp,
  isJellyfinSignInEnabled,
  isPlexMediaServer,
  jellyfinClient,
  jellyfinDeviceId,
} from '@server/lib/jellyfinSignIn';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';
import {
  isOwnProfile,
  isOwnProfileOrAdmin,
} from '@server/utils/profileMiddleware';
import { Router } from 'express';

/**
 * Linking a Jellyfin account on a Plex media server, mounted at `/user` ahead
 * of upstream's routes, which only allow it while Jellyfin is the media
 * server. Steps aside in every other case.
 */
const jellyfinSignInUserRoutes = Router();

jellyfinSignInUserRoutes.post<{ id: string }>(
  '/:id/settings/linked-accounts/jellyfin',
  (_req, _res, next) => (isJellyfinSignInEnabled() ? next() : next('router')),
  isOwnProfile(),
  async (req, res) => {
    const userRepository = getRepository(User);
    const body = req.body as { username?: string; password?: string };

    if (!req.user) {
      return res.status(401).json({ code: ApiErrorCode.Unauthorized });
    }

    if (
      await userRepository.exist({
        where: { jellyfinUsername: body.username },
      })
    ) {
      return res.status(422).json({
        message: 'The specified account is already linked to a Seerr user',
      });
    }

    const deviceId = jellyfinDeviceId(req.user.username ?? '');

    try {
      const account = await jellyfinClient(deviceId).login(
        body.username,
        body.password,
        clientIp(req)
      );

      if (
        await userRepository.exist({
          where: { jellyfinUserId: account.User.Id },
        })
      ) {
        return res.status(422).json({
          message: 'The specified account is already linked to a Seerr user',
        });
      }

      const user = req.user;
      user.jellyfinUserId = account.User.Id;
      user.jellyfinUsername = account.User.Name;
      user.jellyfinAuthToken = account.AccessToken;
      user.jellyfinDeviceId = deviceId;
      // A Plex user stays a Plex user; a local user now signs in with Jellyfin.
      if (user.userType === UserType.LOCAL) {
        user.userType = UserType.JELLYFIN;
      }
      await userRepository.save(user);

      return res.status(204).send();
    } catch (e) {
      logger.error('Failed to link Jellyfin account to user.', {
        label: 'API',
        ip: req.ip,
        error: e,
      });
      if (
        e instanceof ApiError &&
        e.errorCode === ApiErrorCode.InvalidCredentials
      ) {
        return res.status(401).json({ code: e.errorCode });
      }

      return res.status(500).send();
    }
  }
);

jellyfinSignInUserRoutes.delete<{ id: string }>(
  '/:id/settings/linked-accounts/jellyfin',
  // Unlinking stays possible while sign-in is switched off, so a link never
  // gets stuck; it only clears Seerr's copy of the account.
  (_req, _res, next) => (isPlexMediaServer() ? next() : next('router')),
  isOwnProfileOrAdmin(),
  async (req, res) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository
        .createQueryBuilder('user')
        .addSelect('user.password')
        .where({ id: Number(req.params.id) })
        .getOne();

      if (!user) {
        return res.status(404).json({ message: 'User not found.' });
      }

      // The user must keep a way to sign in: Plex, or a local password.
      if (!user.plexId && !(user.email && user.password)) {
        return res.status(400).json({
          message: 'User does not have a local email or password set.',
        });
      }

      user.jellyfinUserId = null;
      user.jellyfinUsername = null;
      user.jellyfinAuthToken = null;
      user.jellyfinDeviceId = null;
      if (user.userType === UserType.JELLYFIN) {
        user.userType = UserType.LOCAL;
      }
      await userRepository.save(user);

      return res.status(204).send();
    } catch (e) {
      return res.status(500).json({ message: e.message });
    }
  }
);

export default jellyfinSignInUserRoutes;
