import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MediaServerType } from '@server/constants/server';
import migrateSplitAuthProviders from './0009_split_auth_providers';

/**
 * Migrations are re-run on every boot, so the guards matter as much as the
 * mapping: an admin's choice must never be silently reverted on restart.
 */
describe('settings migration: split auth providers', () => {
  it('enables only Plex sign-in for a Plex install', () => {
    const migrated = migrateSplitAuthProviders({
      main: { mediaServerType: MediaServerType.PLEX, mediaServerLogin: true },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, true);
    assert.strictEqual(migrated.main.jellyfinLogin, false);
  });

  it('enables only Jellyfin sign-in for a Jellyfin install', () => {
    const migrated = migrateSplitAuthProviders({
      main: {
        mediaServerType: MediaServerType.JELLYFIN,
        mediaServerLogin: true,
      },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, false);
    assert.strictEqual(migrated.main.jellyfinLogin, true);
  });

  it('enables only Jellyfin sign-in for an Emby install', () => {
    const migrated = migrateSplitAuthProviders({
      main: { mediaServerType: MediaServerType.EMBY, mediaServerLogin: true },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, false);
    assert.strictEqual(migrated.main.jellyfinLogin, true);
  });

  it('carries a disabled media server sign-in across to both providers', () => {
    const migrated = migrateSplitAuthProviders({
      main: { mediaServerType: MediaServerType.PLEX, mediaServerLogin: false },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, false);
    assert.strictEqual(migrated.main.jellyfinLogin, false);
  });

  it('treats an absent mediaServerLogin as enabled', () => {
    const migrated = migrateSplitAuthProviders({
      main: { mediaServerType: MediaServerType.PLEX },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, true);
  });

  it('leaves an admin choice alone when re-run', () => {
    // A Plex install where the admin has since turned Plex sign-in off and
    // added Jellyfin as a second provider.
    const settings = {
      main: {
        mediaServerType: MediaServerType.PLEX,
        mediaServerLogin: true,
        plexLogin: false,
        jellyfinLogin: true,
      },
      jellyfin: {},
    };

    const migrated = migrateSplitAuthProviders(structuredClone(settings));

    assert.strictEqual(migrated.main.plexLogin, false);
    assert.strictEqual(migrated.main.jellyfinLogin, true);
  });

  it('leaves both providers unset when setup never finished', () => {
    // Deriving from NOT_CONFIGURED would disable both, and setup itself never
    // sets either flag — the install could not sign in to its own first admin.
    const migrated = migrateSplitAuthProviders({
      main: {
        mediaServerType: MediaServerType.NOT_CONFIGURED,
        mediaServerLogin: true,
      },
      jellyfin: {},
    });

    assert.strictEqual(migrated.main.plexLogin, undefined);
    assert.strictEqual(migrated.main.jellyfinLogin, undefined);
  });

  it('is idempotent', () => {
    const settings = {
      main: { mediaServerType: MediaServerType.EMBY, mediaServerLogin: true },
      jellyfin: {},
    };

    const once = migrateSplitAuthProviders(structuredClone(settings));
    const twice = migrateSplitAuthProviders(structuredClone(once));

    assert.deepStrictEqual(twice, once);
  });
});
