import { UserType } from '@server/constants/user';

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
 *
 * A LOCAL user never has a Plex account, whatever `plexUsername` says: an old
 * Overseerr migration (AddDisplayNameToUser) copied every user's username into
 * `plexUsername`, local users included.
 */
export const hasPlexAccount = (user?: {
  plexUsername?: string | null;
  userType?: UserType;
}): boolean => !!user?.plexUsername && user.userType !== UserType.LOCAL;

/** Whether a user has a Jellyfin/Emby account linked; see `hasPlexAccount`. */
export const hasJellyfinAccount = (user?: {
  jellyfinUsername?: string | null;
}): boolean => !!user?.jellyfinUsername;
