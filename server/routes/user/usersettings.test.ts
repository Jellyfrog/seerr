import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-link-user-001',
    Name: 'linkeduser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);

const PLEX_ACCOUNT_ID = 424242;

mock.method(
  PlexTvAPI.prototype,
  'getUser',
  async () =>
    ({
      id: PLEX_ACCOUNT_ID,
      email: 'someone-else@plex.tv',
      username: 'plexfriend',
      authToken: 'plex-token',
    }) as Awaited<ReturnType<PlexTvAPI['getUser']>>
);

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

function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.useSsl = false;
  settings.jellyfin.urlBase = '';
}

async function loginAs(email: string, password: string) {
  const settings = getSettings();
  settings.main.localLogin = true;

  const agent = request.agent(app);
  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return { agent, userId: res.body.id as number };
}

describe('POST /user/:id/settings/linked-accounts/jellyfin/quickconnect', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    configureJellyfin();
  });

  it('links the account when the media server is Jellyfin', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 204);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 1);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, 'jf-link-user-001');
    assert.strictEqual(user.userType, UserType.JELLYFIN);
  });

  it('returns 403 when the media server is Emby', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.strictEqual(user.jellyfinUserId, null);
  });

  it('returns ACCOUNT_ALREADY_LINKED when the Jellyfin account is already linked', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(
      { email: 'admin@seerr.dev' },
      { jellyfinUserId: defaultAuthenticateResponse.User.Id }
    );

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin/quickconnect`)
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, ApiErrorCode.AccountAlreadyLinked);
  });
});

describe('POST /user/:id/settings/linked-accounts/jellyfin', () => {
  beforeEach(() => {
    configureJellyfin();
  });

  it('returns ACCOUNT_ALREADY_LINKED when the Jellyfin account is already linked', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(
      { email: 'admin@seerr.dev' },
      { jellyfinUsername: 'linkeduser' }
    );

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/jellyfin`)
      .send({ username: 'linkeduser', password: 'secret' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, ApiErrorCode.AccountAlreadyLinked);
  });
});

describe('POST /user/:id/settings/linked-accounts/plex', () => {
  beforeEach(() => {
    getSettings().main.mediaServerType = MediaServerType.PLEX;
  });

  it('returns EMAIL_MISMATCH when the Plex email does not match', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/plex`)
      .send({ authToken: 'plex-token' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, ApiErrorCode.EmailMismatch);

    const user = await getRepository(User).findOneOrFail({
      where: { id: userId },
    });
    assert.notStrictEqual(user.plexId, PLEX_ACCOUNT_ID);
  });

  it('returns ACCOUNT_ALREADY_LINKED when the Plex account is already linked', async () => {
    const { agent, userId } = await loginAs('demo@seerr.dev', 'test1234');
    await getRepository(User).update(
      { email: 'admin@seerr.dev' },
      { plexId: PLEX_ACCOUNT_ID }
    );

    const res = await agent
      .post(`/user/${userId}/settings/linked-accounts/plex`)
      .send({ authToken: 'plex-token' });

    assert.strictEqual(res.status, 422);
    assert.strictEqual(res.body.code, ApiErrorCode.AccountAlreadyLinked);
  });
});
