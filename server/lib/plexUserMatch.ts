import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';

/**
 * Finds the Seerr user a Plex account belongs to, for Plex sign-in and import.
 *
 * The account's own link wins; a matching email is only a fallback for
 * adopting a local-only user. `emailOnly` is set when the match rests on the
 * email alone but the user already has another media server account: users
 * can edit their own email, so that match proves nothing and must not graft
 * this Plex account onto them. Such users link Plex from their profile.
 */
export const findPlexUserMatch = async (account: {
  id: number;
  email: string;
}): Promise<{ user: User | null; emailOnly: boolean }> => {
  const matches = await getRepository(User)
    .createQueryBuilder('user')
    .where('user.plexId = :plexId', { plexId: account.id })
    .orWhere('user.email = :email', { email: account.email.toLowerCase() })
    .getMany();
  const user =
    matches.find((match) => match.plexId === account.id) ?? matches[0] ?? null;

  return {
    user,
    emailOnly:
      !!user &&
      user.plexId !== account.id &&
      !!(user.plexId || user.jellyfinUserId),
  };
};
