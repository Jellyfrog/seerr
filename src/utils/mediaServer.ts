export {
  getJellyfinServerName,
  isJellyfinPrimary,
  isPlexPrimary,
} from '@server/lib/mediaServer';

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

/** Whether a user has a Jellyfin/Emby account linked; see `hasPlexAccount`. */
export const hasJellyfinAccount = (user?: {
  jellyfinUsername?: string | null;
}): boolean => !!user?.jellyfinUsername;
