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
 * Whether the Jellyfin/Emby connection is a Jellyfin or an Emby server.
 */
export const getJellyfinServerType = (
  mediaServerType: MediaServerType
): MediaServerType.JELLYFIN | MediaServerType.EMBY =>
  mediaServerType === MediaServerType.EMBY
    ? MediaServerType.EMBY
    : MediaServerType.JELLYFIN;

/** The display name of the Jellyfin/Emby connection. */
export const getJellyfinServerName = (
  mediaServerType: MediaServerType
): ServerType =>
  mediaServerType === MediaServerType.EMBY
    ? ServerType.EMBY
    : ServerType.JELLYFIN;
