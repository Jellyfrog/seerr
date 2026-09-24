import { MediaServerType, ServerType } from '@server/constants/server';

/**
 * The display name of the configured Jellyfin/Emby connection.
 *
 * Mirrors the `jellyfinServerName` getter on the server's settings. Derive the
 * name here rather than inlining the comparison: written out per call site it
 * drifts, both in which field it reads and in which way round the ternary goes.
 */
export const getJellyfinServerName = (
  jellyfinServerType: MediaServerType
): ServerType =>
  jellyfinServerType === MediaServerType.EMBY
    ? ServerType.EMBY
    : ServerType.JELLYFIN;

/** Whether Plex is the media backend. Mirrors `Settings.plexIsPrimary`. */
export const isPlexPrimary = (mediaServerType: MediaServerType): boolean =>
  mediaServerType === MediaServerType.PLEX;

/**
 * Whether Jellyfin/Emby is the media backend. Mirrors
 * `Settings.jellyfinIsPrimary`.
 */
export const isJellyfinPrimary = (mediaServerType: MediaServerType): boolean =>
  mediaServerType === MediaServerType.JELLYFIN ||
  mediaServerType === MediaServerType.EMBY;

/**
 * Whether a user has a Plex account linked.
 *
 * Deliberately not `userType === UserType.PLEX`. Those were equivalent while a
 * user could only ever belong to one media server, but Plex can now be a
 * secondary authentication provider: such a user keeps their primary identity
 * and still has a linked Plex account. The watchlist and watch-data routes key
 * off the Plex account (`plexToken` / `plexId`), so the UI must too, or it
 * labels a real Plex watchlist as local. `plexUsername` is the stand-in the
 * filtered user payload exposes — `plexId` is withheld from clients.
 */
export const hasPlexAccount = (user?: {
  plexUsername?: string | null;
}): boolean => !!user?.plexUsername;
