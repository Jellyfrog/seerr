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
