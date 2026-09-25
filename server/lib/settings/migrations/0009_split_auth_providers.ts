import { MediaServerType } from '@server/constants/server';
import type { AllSettings } from '@server/lib/settings';

/**
 * Plex and Jellyfin/Emby sign-in used to be mutually exclusive: a single
 * `main.mediaServerLogin` switch applied to whichever server happened to be the
 * media backend. Both providers can now be enabled at once, so the switch is
 * split per provider.
 *
 * Migrations are re-run on every boot, so each step is guarded on the new key
 * being absent. Without that, an admin disabling a provider would have it
 * silently re-enabled on the next restart.
 */
const migrateSplitAuthProviders = (settings: any): AllSettings => {
  const main = settings.main ?? {};

  // Absent means "on" — that was the default for the old single switch.
  const mediaServerLogin = main.mediaServerLogin !== false;

  // A settings file that never finished setup has no media server to map the
  // old switch onto. Leaving the flags unset lets the defaults (both on) apply,
  // so that whichever server setup ends up configuring can be signed in with.
  // Deriving from NOT_CONFIGURED would disable both and lock the install out of
  // its own first sign-in.
  const mediaServerConfigured =
    main.mediaServerType === MediaServerType.PLEX ||
    main.mediaServerType === MediaServerType.JELLYFIN ||
    main.mediaServerType === MediaServerType.EMBY;

  if (mediaServerConfigured) {
    if (typeof main.plexLogin !== 'boolean') {
      main.plexLogin =
        mediaServerLogin && main.mediaServerType === MediaServerType.PLEX;
    }

    if (typeof main.jellyfinLogin !== 'boolean') {
      main.jellyfinLogin =
        mediaServerLogin &&
        (main.mediaServerType === MediaServerType.JELLYFIN ||
          main.mediaServerType === MediaServerType.EMBY);
    }
  }

  settings.main = main;

  return settings;
};

export default migrateSplitAuthProviders;
