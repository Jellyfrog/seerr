import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import type { MainSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { getHostname } from '@server/utils/getHostname';
import type { Request } from 'express';
import net from 'net';

/**
 * Jellyfin sign-in next to a Plex media server.
 *
 * Plex stays the media server; Jellyfin only authenticates users who have
 * linked a Jellyfin account. Everything lives outside the upstream sign-in
 * code so that this can be carried as a patch: the routers here are mounted
 * ahead of upstream's and step aside (`next()`) whenever they do not apply.
 */

/**
 * The switch is kept in `main` under a name of its own. The settings loader
 * keeps unknown keys and `POST /settings/main` merges the request body, so it
 * needs no schema change.
 */
type MainWithJellyfinSignIn = MainSettings & { jellyfinSignIn?: boolean };

/** Whether Plex is the media server, which is the only case handled here. */
export const isPlexMediaServer = (): boolean =>
  getSettings().main.mediaServerType === MediaServerType.PLEX;

/** Whether users may sign in with a linked Jellyfin account. */
export const isJellyfinSignInEnabled = (): boolean => {
  const settings = getSettings();

  return (
    isPlexMediaServer() &&
    !!(settings.main as MainWithJellyfinSignIn).jellyfinSignIn &&
    !!settings.jellyfin.ip
  );
};

/** A client for the configured Jellyfin server. */
export const jellyfinClient = (deviceId?: string): JellyfinAPI =>
  new JellyfinAPI(getHostname(), undefined, deviceId);

/** The caller's IP in the form Jellyfin expects, as upstream's sign-in does. */
export const clientIp = (req: Request): string | undefined => {
  const ip = req.ip;

  if (ip && net.isIPv4(ip)) {
    return ip;
  }
  if (ip && net.isIPv6(ip)) {
    return ip.startsWith('::ffff:') ? ip.substring(7) : ip;
  }

  return undefined;
};

/** The device id Jellyfin sessions are opened under, as upstream derives it. */
export const jellyfinDeviceId = (name: string): string =>
  Buffer.from(`BOT_seerr_${name}`).toString('base64');
