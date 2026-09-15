import { MediaServerType } from '@server/constants/server';
import type { AllSettings } from '@server/lib/settings';

/**
 * Plex and Jellyfin/Emby sign-in used to be mutually exclusive: a single
 * `main.mediaServerLogin` switch applied to whichever server happened to be the
 * media backend. Both providers can now be enabled at once, so the switch is
 * split per provider and the Jellyfin/Emby flavour — previously only implied by
 * `main.mediaServerType` — is recorded on the connection itself.
 *
 * Migrations are re-run on every boot, so each step is guarded on the new key
 * being absent. Without that, an admin disabling a provider would have it
 * silently re-enabled on the next restart.
 */
const migrateSplitAuthProviders = (settings: any): AllSettings => {
  const main = settings.main ?? {};
  const jellyfin = settings.jellyfin ?? {};

  if (
    jellyfin.serverType !== MediaServerType.JELLYFIN &&
    jellyfin.serverType !== MediaServerType.EMBY
  ) {
    jellyfin.serverType =
      main.mediaServerType === MediaServerType.EMBY
        ? MediaServerType.EMBY
        : MediaServerType.JELLYFIN;
  }

  // Absent means "on" — that was the default for the old single switch.
  const mediaServerLogin = main.mediaServerLogin !== false;

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

  settings.main = main;
  settings.jellyfin = jellyfin;

  return settings;
};

export default migrateSplitAuthProviders;
