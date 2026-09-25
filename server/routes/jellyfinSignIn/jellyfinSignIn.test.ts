import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import type { MainSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import userRoutes from '@server/routes/user';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import jellyfinSignInAuthRoutes from './auth';
import jellyfinSignInUserRoutes from './user';

const JELLYFIN_ACCOUNT = {
  User: {
    Id: 'jf-secondary-001',
    Name: 'jellyfinuser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'jellyfin-access-token',
};

const loginMock = mock.method(JellyfinAPI.prototype, 'login', async () => ({
  ...JELLYFIN_ACCOUNT,
}));

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

let app: Express;

// Mounted the way server/routes/index.ts mounts them: sidecar first.
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
  app.use('/auth', jellyfinSignInAuthRoutes);
  app.use('/auth', authRoutes);
  app.use('/user', isAuthenticated(), jellyfinSignInUserRoutes);
  app.use('/user', isAuthenticated(), userRoutes);
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

/** Plex is the media server, with Jellyfin set up for sign-in only. */
function plexWithJellyfinSignIn(enabled = true) {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.main.newPlexLogin = true;
  (
    settings.main as MainSettings & { jellyfinSignIn?: boolean }
  ).jellyfinSignIn = enabled;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

async function saveUser(fields: Partial<User>) {
  return getRepository(User).save(
    new User({ permissions: 0, avatar: '', ...fields })
  );
}

async function loginAs(email: string, password: string) {
  getSettings().main.localLogin = true;

  const agent = request.agent(app);
  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return { agent, userId: res.body.id as number };
}

describe('Jellyfin sign-in next to a Plex media server', () => {
  beforeEach(() => {
    loginMock.mock.resetCalls();
    initiateQCMock.mock.resetCalls();
    authenticateQCMock.mock.resetCalls();
    plexWithJellyfinSignIn();
  });

  it('reports whether it is enabled', async () => {
    let res = await request(app).get('/auth/jellyfin/secondary');
    assert.deepStrictEqual(res.body, { enabled: true });

    plexWithJellyfinSignIn(false);
    res = await request(app).get('/auth/jellyfin/secondary');
    assert.deepStrictEqual(res.body, { enabled: false });
  });

  it('signs in a linked user without touching their Plex identity', async () => {
    const linked = await saveUser({
      email: 'plex-user@seerr.dev',
      plexId: 9001,
      plexUsername: 'plexuser',
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      jellyfinUsername: 'stale-name',
      avatar: 'https://plex.tv/avatar.png',
      userType: UserType.PLEX,
    });

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, linked.id);

    const saved = await getRepository(User).findOneOrFail({
      where: { id: linked.id },
    });
    assert.strictEqual(saved.jellyfinUsername, JELLYFIN_ACCOUNT.User.Name);
    assert.strictEqual(saved.userType, UserType.PLEX);
    assert.strictEqual(saved.avatar, 'https://plex.tv/avatar.png');

    const me = await agent.get('/auth/me');
    assert.strictEqual(me.body.id, linked.id);
  });

  it('denies an unlinked account even when new sign-ins are allowed', async () => {
    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 403);
    const created = await getRepository(User).findOne({
      where: { jellyfinUserId: JELLYFIN_ACCOUNT.User.Id },
    });
    assert.strictEqual(created, null);
  });

  it('leaves the request to upstream when switched off', async () => {
    plexWithJellyfinSignIn(false);

    const res = await request(app)
      .post('/auth/jellyfin')
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Jellyfin login is disabled');
    assert.strictEqual(loginMock.mock.callCount(), 0);
  });

  it('stays out of the way when Jellyfin is the media server', async () => {
    getSettings().main.mediaServerType = MediaServerType.JELLYFIN;

    const res = await request(app).get('/auth/jellyfin/secondary');
    assert.deepStrictEqual(res.body, { enabled: false });

    // Upstream's Quick Connect handles it.
    const qc = await request(app).post('/auth/jellyfin/quickconnect/initiate');
    assert.strictEqual(qc.status, 200);
  });

  it('offers Quick Connect and signs in only linked users with it', async () => {
    const initiate = await request(app).post(
      '/auth/jellyfin/quickconnect/initiate'
    );
    assert.strictEqual(initiate.status, 200);
    assert.strictEqual(initiate.body.code, '123456');

    const denied = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });
    assert.strictEqual(denied.status, 403);

    const linked = await saveUser({
      email: 'qc-user@seerr.dev',
      plexId: 9002,
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      userType: UserType.PLEX,
    });
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.id, linked.id);
  });
});

describe('Linking a Jellyfin account next to a Plex media server', () => {
  beforeEach(() => {
    loginMock.mock.resetCalls();
    plexWithJellyfinSignIn();
  });

  it('links the account and keeps the user type of a Plex user', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(userId, {
      plexId: 9003,
      userType: UserType.PLEX,
    });

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin`)
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 204);
    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, JELLYFIN_ACCOUNT.User.Id);
    assert.strictEqual(user.userType, UserType.PLEX);
  });

  it('makes a local user a Jellyfin user', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(userId, { userType: UserType.LOCAL });

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin`)
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 204);
    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.userType, UserType.JELLYFIN);
  });

  it('refuses an account that is already linked', async () => {
    await saveUser({
      email: 'other@seerr.dev',
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      userType: UserType.JELLYFIN,
    });
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin`)
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 422);
  });

  it('leaves linking to upstream when switched off', async () => {
    plexWithJellyfinSignIn(false);
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin`)
      .send({ username: 'jellyfinuser', password: 'password' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(loginMock.mock.callCount(), 0);
  });

  it('unlinks, even while sign-in is switched off', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(userId, {
      jellyfinUserId: JELLYFIN_ACCOUNT.User.Id,
      jellyfinUsername: 'jellyfinuser',
      userType: UserType.JELLYFIN,
    });
    plexWithJellyfinSignIn(false);

    const res = await agent.delete(
      `/user/${userId}/settings/linked-accounts/jellyfin`
    );

    assert.strictEqual(res.status, 204);
    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, null);
    assert.strictEqual(user.userType, UserType.LOCAL);
  });
});
