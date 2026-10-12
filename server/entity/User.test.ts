import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';

// resolveUserType reads only the user's linked ids and the settings singleton,
// so these stay pure unit tests — no database needed.

/** Plex is the media backend, with Jellyfin configured only for sign-in. */
function plexBackendWithJellyfinAuth() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.serverType = MediaServerType.JELLYFIN;
}

/** Jellyfin is the media backend, with Plex configured only for sign-in. */
function jellyfinBackendWithPlexAuth() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.plex.ip = 'plex.local';
  settings.plex.machineId = 'machine-1';
}

describe('User.resolveUserType', () => {
  beforeEach(() => {
    plexBackendWithJellyfinAuth();
  });

  it('prefers the primary media server account', () => {
    const user = new User({
      email: 'dual-type@seerr.dev',
      plexId: 1,
      jellyfinUserId: 'jf-1',
    });

    assert.strictEqual(user.resolveUserType(), UserType.PLEX);

    jellyfinBackendWithPlexAuth();
    assert.strictEqual(user.resolveUserType(), UserType.JELLYFIN);
  });

  it('falls back to the secondary account rather than demoting to local', () => {
    // A user whose only account is on the secondary provider can still sign in
    // with it, so calling them LOCAL would be wrong.
    const user = new User({
      email: 'jellyfin-only@seerr.dev',
      jellyfinUserId: 'jf-2',
    });

    assert.strictEqual(user.resolveUserType(), UserType.JELLYFIN);
  });

  it('uses the connection flavour, not the media server type, for Emby', () => {
    // Plex is the backend, so mediaServerType says nothing about the flavour.
    getSettings().jellyfin.serverType = MediaServerType.EMBY;
    const user = new User({
      email: 'emby-secondary@seerr.dev',
      jellyfinUserId: 'jf-3',
    });

    assert.strictEqual(user.resolveUserType(), UserType.EMBY);
  });

  it('is local for a user with no linked account', () => {
    const user = new User({ email: 'local-only@seerr.dev' });

    assert.strictEqual(user.resolveUserType(), UserType.LOCAL);
  });
});
