import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';

// Sign-in with Plex and Jellyfin enabled at the same time. Kept apart from
// auth.test.ts so that file can follow upstream unchanged.

const PLEX_ACCOUNT = {
  id: 4242,
  uuid: 'plex-uuid',
  email: 'linked-plex@seerr.dev',
  joined_at: '',
  username: 'plexuser',
  title: 'plexuser',
  thumb: 'https://plex.tv/avatar.png',
  hasPassword: true,
  authToken: 'plex-auth-token',
  subscription: {
    active: true,
    status: 'active',
    plan: 'plan',
    features: [],
  },
  roles: { roles: [] },
  entitlements: [],
};

const JELLYFIN_ACCOUNT = {
  User: {
    Id: 'jf-dual-user-001',
    Name: 'jellyfinuser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'jellyfin-access-token',
};

const getPlexUserMock = mock.method(
  PlexTvAPI.prototype,
  'getUser',
  async () => ({
    ...PLEX_ACCOUNT,
  })
);

// Nothing in these tests should need to consult the admin's Plex friend list:
// a linked secondary account is authorization enough.
const checkUserAccessMock = mock.method(
  PlexTvAPI.prototype,
  'checkUserAccess',
  async () => false
);

const jellyfinLoginMock = mock.method(
  JellyfinAPI.prototype,
  'login',
  async () => ({
    ...JELLYFIN_ACCOUNT,
  })
);

const initiateQCMock = mock.method(
  JellyfinAPI.prototype,
  'initiateQuickConnect',
  async () => ({
    Secret: 'abc123def456abc123def456',
    Code: '123456',
    DateAdded: new Date().toISOString(),
  })
);

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...JELLYFIN_ACCOUNT })
);

mock.method(axios, 'head', async () => ({
  status: 200,
  headers: { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
}));
mock.method(ImageProxy.prototype, 'clearCachedImage', async () => undefined);

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(async () => {
  app = createApp();
});

setupTestDb();

function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.main.newPlexLogin = true;
  settings.main.jellyfinLogin = true;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

/** Jellyfin is the media backend, with Plex configured only for sign-in. */
function jellyfinBackendWithPlexAuth() {
  configureJellyfin();
  const settings = getSettings();
  settings.main.plexLogin = true;
  settings.plex.ip = 'plex.local';
  settings.plex.machineId = 'machine-1';
}

/** Plex is the media backend, with Jellyfin configured only for sign-in. */
function plexBackendWithJellyfinAuth() {
  jellyfinBackendWithPlexAuth();
  getSettings().main.mediaServerType = MediaServerType.PLEX;
}

describe('Jellyfin Quick Connect with per-provider sign-in', () => {
  beforeEach(() => {
    initiateQCMock.mock.resetCalls();
    authenticateQCMock.mock.resetCalls();
    configureJellyfin();
  });

  it('stays available for linking while Jellyfin sign-in is off', async () => {
    // Profile linking uses this same flow, and linking stays open on the media
    // server even with Jellyfin sign-in switched off.
    getSettings().main.jellyfinLogin = false;

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(initiateQCMock.mock.callCount(), 1);
  });

  it('refuses to authenticate when Jellyfin sign-in is disabled', async () => {
    getSettings().main.jellyfinLogin = false;

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('denies an unlinked account when Jellyfin is only a sign-in provider', async () => {
    plexBackendWithJellyfinAuth();

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    const created = await getRepository(User).findOne({
      where: { jellyfinUserId: JELLYFIN_ACCOUNT.User.Id },
    });
    assert.strictEqual(created, null);
  });
});

describe('POST /auth/plex with Plex as a secondary provider', () => {
  beforeEach(() => {
    getPlexUserMock.mock.resetCalls();
    checkUserAccessMock.mock.resetCalls();
    checkUserAccessMock.mock.mockImplementation(async () => false);
    jellyfinBackendWithPlexAuth();
  });

  it('signs in a user who has linked their Plex account', async () => {
    const userRepo = getRepository(User);
    const linked = new User({
      email: 'jellyfin-primary@seerr.dev',
      jellyfinUsername: 'jellyfinuser',
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      plexId: PLEX_ACCOUNT.id,
      plexUsername: 'stale-plex-username',
      permissions: 0,
      avatar: '/avatarproxy/jf-dual-user-001?v=0',
      userType: UserType.JELLYFIN,
    });
    await userRepo.save(linked);

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, linked.id);

    const saved = await userRepo.findOneOrFail({ where: { id: linked.id } });
    // Plex owns these two fields and may refresh them...
    assert.strictEqual(saved.plexUsername, PLEX_ACCOUNT.username);
    // ...but the primary Jellyfin identity must survive untouched.
    assert.strictEqual(saved.userType, UserType.JELLYFIN);
    assert.strictEqual(saved.email, 'jellyfin-primary@seerr.dev');
    assert.strictEqual(saved.avatar, '/avatarproxy/jf-dual-user-001?v=0');
  });

  it('does not consult the admin Plex friend list for a linked account', async () => {
    const userRepo = getRepository(User);
    await userRepo.save(
      new User({
        email: 'jellyfin-primary-2@seerr.dev',
        jellyfinUserId: 'jf-dual-user-002',
        plexId: PLEX_ACCOUNT.id,
        permissions: 0,
        avatar: '',
        userType: UserType.JELLYFIN,
      })
    );

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(checkUserAccessMock.mock.callCount(), 0);
  });

  it('denies a Plex account that has not been linked', async () => {
    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 403);
  });

  it('does not match an unlinked account on email alone', async () => {
    const userRepo = getRepository(User);
    await userRepo.save(
      new User({
        // Same email as the Plex account, but no link has been established.
        email: PLEX_ACCOUNT.email,
        jellyfinUserId: 'jf-dual-user-003',
        permissions: 0,
        avatar: '',
        userType: UserType.JELLYFIN,
      })
    );

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 403);
  });

  it('rejects a Plex.tv account with no id instead of matching the admin', async () => {
    // An undefined value in a TypeORM `where` is ignored, so a lookup keyed on
    // a missing account id would match the first user row and hand out the
    // admin's session.
    getPlexUserMock.mock.mockImplementationOnce(async () => ({
      ...PLEX_ACCOUNT,
      id: undefined as unknown as number,
    }));

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 403);
    assert.ok(!('id' in res.body));

    // The admin's Plex credentials must be untouched.
    const admin = await getRepository(User)
      .createQueryBuilder('user')
      .addSelect('user.plexToken')
      .where('user.id = :id', { id: 1 })
      .getOneOrFail();
    assert.notStrictEqual(admin.plexToken, PLEX_ACCOUNT.authToken);
  });

  it('refuses Plex sign-in when the provider is disabled', async () => {
    getSettings().main.plexLogin = false;

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Plex login is disabled');
  });
});

describe('POST /auth/jellyfin with Jellyfin as a secondary provider', () => {
  beforeEach(() => {
    jellyfinLoginMock.mock.resetCalls();
    jellyfinLoginMock.mock.mockImplementation(async () => ({
      ...JELLYFIN_ACCOUNT,
    }));
    plexBackendWithJellyfinAuth();
  });

  it('signs in a user who has linked their Jellyfin account', async () => {
    const userRepo = getRepository(User);
    const linked = new User({
      email: 'plex-primary@seerr.dev',
      plexId: 9001,
      plexUsername: 'plexprimary',
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      jellyfinUsername: 'stale-jellyfin-username',
      permissions: 0,
      avatar: 'https://plex.tv/avatar.png',
      userType: UserType.PLEX,
    });
    await userRepo.save(linked);

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, linked.id);

    const saved = await userRepo.findOneOrFail({ where: { id: linked.id } });
    assert.strictEqual(saved.jellyfinUsername, JELLYFIN_ACCOUNT.User.Name);
    // The primary Plex identity must survive untouched.
    assert.strictEqual(saved.userType, UserType.PLEX);
    assert.strictEqual(saved.avatar, 'https://plex.tv/avatar.png');
  });

  it('denies an unlinked Jellyfin account even when new sign-ins are allowed', async () => {
    getSettings().main.newPlexLogin = true;

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 403);

    const created = await getRepository(User).findOne({
      where: { jellyfinUserId: JELLYFIN_ACCOUNT.User.Id },
    });
    assert.strictEqual(created, null);
  });

  it('refuses Jellyfin sign-in when the provider is disabled', async () => {
    getSettings().main.jellyfinLogin = false;

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Jellyfin login is disabled');
  });
});

describe('media server sign-in when both providers are enabled', () => {
  beforeEach(() => {
    getPlexUserMock.mock.resetCalls();
    jellyfinLoginMock.mock.resetCalls();
    jellyfinLoginMock.mock.mockImplementation(async () => ({
      ...JELLYFIN_ACCOUNT,
    }));
    // Plex is the media backend here, so its own sign-in path still checks that
    // the account has access to the admin's Plex server.
    checkUserAccessMock.mock.mockImplementation(async () => true);
    plexBackendWithJellyfinAuth();
  });

  it('accepts the same user through either provider', async () => {
    const userRepo = getRepository(User);
    const dual = new User({
      email: 'dual@seerr.dev',
      plexId: PLEX_ACCOUNT.id,
      plexUsername: 'plexuser',
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      jellyfinUsername: 'jellyfinuser',
      permissions: 0,
      avatar: 'https://plex.tv/avatar.png',
      userType: UserType.PLEX,
    });
    await userRepo.save(dual);

    const viaPlex = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });
    assert.strictEqual(viaPlex.status, 200);
    assert.strictEqual(viaPlex.body.id, dual.id);

    const viaJellyfin = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });
    assert.strictEqual(viaJellyfin.status, 200);
    assert.strictEqual(viaJellyfin.body.id, dual.id);

    // Signing in through the secondary provider must not have rewritten the
    // primary identity.
    const saved = await userRepo.findOneOrFail({ where: { id: dual.id } });
    assert.strictEqual(saved.userType, UserType.PLEX);
  });

  it('does not graft a Plex account onto a Jellyfin user by email alone', async () => {
    const userRepo = getRepository(User);
    const jellyfinOnly = await userRepo.save(
      new User({
        // Users can set their own email, so a match proves nothing about Plex.
        email: PLEX_ACCOUNT.email,
        jellyfinUserId: 'jf-dual-user-004',
        jellyfinUsername: 'someoneelse',
        permissions: 0,
        avatar: '',
        userType: UserType.JELLYFIN,
      })
    );

    const res = await request(app)
      .post('/auth/plex')
      .send({ authToken: PLEX_ACCOUNT.authToken });

    assert.strictEqual(res.status, 403);
    assert.ok(!('id' in res.body));

    const saved = await userRepo.findOneOrFail({
      where: { id: jellyfinOnly.id },
    });
    assert.strictEqual(saved.plexId, null);
    assert.strictEqual(saved.userType, UserType.JELLYFIN);
  });
});
