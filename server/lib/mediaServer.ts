import { MediaServerType, ServerType } from '@server/constants/server';

/**
 * Pure predicates over media server types, shared by the server's settings
 * getters and the client so the two cannot drift apart.
 */

/** Whether Plex is the media backend. */
export const isPlexPrimary = (mediaServerType: MediaServerType): boolean =>
  mediaServerType === MediaServerType.PLEX;

/** Whether Jellyfin/Emby is the media backend. */
export const isJellyfinPrimary = (mediaServerType: MediaServerType): boolean =>
  mediaServerType === MediaServerType.JELLYFIN ||
  mediaServerType === MediaServerType.EMBY;

/**
 * The display name of the Jellyfin/Emby connection. Only Jellyfin can be a
 * secondary sign-in provider, so it is Emby exactly when Emby is the media
 * server.
 */
export const getJellyfinServerName = (
  mediaServerType: MediaServerType
): ServerType =>
  mediaServerType === MediaServerType.EMBY
    ? ServerType.EMBY
    : ServerType.JELLYFIN;
