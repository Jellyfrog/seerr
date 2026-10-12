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
 * The display name of a Jellyfin/Emby connection. Derive the name here rather
 * than inlining the comparison: written out per call site it drifts, both in
 * which field it reads and in which way round the ternary goes.
 */
export const getJellyfinServerName = (
  jellyfinServerType: MediaServerType
): ServerType =>
  jellyfinServerType === MediaServerType.EMBY
    ? ServerType.EMBY
    : ServerType.JELLYFIN;
