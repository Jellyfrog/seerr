import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import { setupTestDb } from '@server/test/db';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import userRoutes from '.';

const ALICE_ID = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const BOB_ID = 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0';
const CAROL_ID = 'c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0';
const ERIN_ID = 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0';
const NOBODY_ID = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';

const JELLYFIN_USERS = [
  { Id: ALICE_ID, Name: 'alice' },
  { Id: BOB_ID, Name: 'bob' },
];

mock.method(JellyfinAPI.prototype, 'getUsers', async () => ({
  users: JELLYFIN_USERS,
}));

const plexUsersMock = mock.method(
  PlexTvAPI.prototype,
  'getUsers',
  async () => ({ MediaContainer: { User: [] } })
);
mock.method(PlexTvAPI.prototype, 'checkUserAccess', async () => true);

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
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

before(() => {
  app = createApp();
});

setupTestDb();

/** Plex is the media backend and Jellyfin only a sign-in provider. */
function configurePlexWithJellyfinAuth() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.main.localLogin = true;
  settings.main.jellyfinLogin = true;
  settings.jellyfin.ip = 'localhost';
  settings.jellyfin.port = 8096;
  settings.jellyfin.serverType = MediaServerType.JELLYFIN;
}

async function loginAs(email: string) {
  const agent = request.agent(app);
  const res = await agent
    .post('/auth/local')
    .send({ email, password: 'test1234' });
  assert.strictEqual(res.status, 200);
  return agent;
}

async function createUser(init: Partial<User>, password?: string) {
  const user = new User({
    permissions: 0,
    userType: UserType.LOCAL,
    avatar: '/avatar.png',
    ...init,
  });
  if (password) {
    await user.setPassword(password);
  }
  return getRepository(User).save(user);
}

const findUser = (id: number) =>
  getRepository(User).findOneOrFail({ where: { id } });

describe('POST /user/import-from-jellyfin with links', () => {
  beforeEach(configurePlexWithJellyfinAuth);

  it('links one account to an existing user and creates the rest', async () => {
    const local = await createUser({ email: 'carol@seerr.dev' });
    const agent = await loginAs('admin@seerr.dev');

    const res = await agent.post('/user/import-from-jellyfin').send({
      jellyfinUserIds: [BOB_ID],
      links: [{ jellyfinUserId: ALICE_ID, userId: local.id }],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.length, 2);

    const linked = await findUser(local.id);
    assert.strictEqual(linked.jellyfinUserId, ALICE_ID);
    assert.strictEqual(linked.jellyfinUsername, 'alice');
    assert.strictEqual(linked.userType, UserType.JELLYFIN);
    assert.strictEqual(linked.email, 'carol@seerr.dev');

    const created = await getRepository(User).findOneOrFail({
      where: { jellyfinUserId: BOB_ID },
    });
    assert.notStrictEqual(created.id, local.id);
  });

  it('does not create a separate user for an account that is linked', async () => {
    const local = await createUser({ email: 'carol@seerr.dev' });
    const agent = await loginAs('admin@seerr.dev');

    const res = await agent.post('/user/import-from-jellyfin').send({
      jellyfinUserIds: [ALICE_ID],
      links: [{ jellyfinUserId: ALICE_ID, userId: local.id }],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(
      await getRepository(User).count({ where: { jellyfinUserId: ALICE_ID } }),
      1
    );
  });

  it('keeps a Plex user on the Plex identity when linking Jellyfin', async () => {
    const plexUser = await createUser({
      email: 'dave@seerr.dev',
      plexId: 4242,
      plexUsername: 'dave',
      userType: UserType.PLEX,
    });
    const agent = await loginAs('admin@seerr.dev');

    const res = await agent.post('/user/import-from-jellyfin').send({
      links: [{ jellyfinUserId: ALICE_ID, userId: plexUser.id }],
    });

    assert.strictEqual(res.status, 201);
    const linked = await findUser(plexUser.id);
    assert.strictEqual(linked.jellyfinUserId, ALICE_ID);
    assert.strictEqual(linked.userType, UserType.PLEX);
  });

  it('lets a user manager link to an ordinary user', async () => {
    await createUser(
      { email: 'manager@seerr.dev', permissions: Permission.MANAGE_USERS },
      'test1234'
    );
    const local = await createUser({ email: 'carol@seerr.dev' });
    const agent = await loginAs('manager@seerr.dev');

    const res = await agent.post('/user/import-from-jellyfin').send({
      links: [{ jellyfinUserId: ALICE_ID, userId: local.id }],
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual((await findUser(local.id)).jellyfinUserId, ALICE_ID);
  });

  it('stops a user manager from linking to the owner or an admin', async () => {
    await createUser(
      { email: 'manager@seerr.dev', permissions: Permission.MANAGE_USERS },
      'test1234'
    );
    const otherAdmin = await createUser({
      email: 'admin2@seerr.dev',
      permissions: Permission.ADMIN,
    });
    const agent = await loginAs('manager@seerr.dev');

    for (const userId of [1, otherAdmin.id]) {
      const res = await agent.post('/user/import-from-jellyfin').send({
        links: [{ jellyfinUserId: ALICE_ID, userId }],
      });

      assert.strictEqual(res.status, 403);
      assert.strictEqual((await findUser(userId)).jellyfinUserId, null);
    }
  });

  it('rejects the whole request when any link is invalid', async () => {
    const carol = await createUser({ email: 'carol@seerr.dev' });
    const agent = await loginAs('admin@seerr.dev');

    const cases = [
      // Unknown Jellyfin user
      [{ jellyfinUserId: NOBODY_ID, userId: carol.id }],
      // Same Seerr user twice
      [
        { jellyfinUserId: ALICE_ID, userId: carol.id },
        { jellyfinUserId: BOB_ID, userId: carol.id },
      ],
    ];

    for (const links of cases) {
      const res = await agent
        .post('/user/import-from-jellyfin')
        .send({ jellyfinUserIds: [BOB_ID], links });

      assert.strictEqual(res.status, 400);
    }

    assert.strictEqual((await findUser(carol.id)).jellyfinUserId, null);
    assert.strictEqual(
      await getRepository(User).count({ where: { jellyfinUserId: BOB_ID } }),
      0
    );
  });

  it('rejects linking an account or a user that is already linked', async () => {
    await createUser({
      email: 'alice@seerr.dev',
      jellyfinUserId: ALICE_ID,
      jellyfinUsername: 'alice',
    });
    const carol = await createUser({
      email: 'carol@seerr.dev',
      jellyfinUserId: CAROL_ID,
      jellyfinUsername: 'carol',
    });
    const dave = await createUser({ email: 'dave@seerr.dev' });
    const agent = await loginAs('admin@seerr.dev');

    const taken = await agent.post('/user/import-from-jellyfin').send({
      links: [{ jellyfinUserId: ALICE_ID, userId: dave.id }],
    });
    assert.strictEqual(taken.status, 422);

    const alreadyLinked = await agent.post('/user/import-from-jellyfin').send({
      links: [{ jellyfinUserId: BOB_ID, userId: carol.id }],
    });
    assert.strictEqual(alreadyLinked.status, 422);
    assert.strictEqual((await findUser(carol.id)).jellyfinUserId, CAROL_ID);
  });
});

describe('POST /user/import-from-plex email matching', () => {
  beforeEach(configurePlexWithJellyfinAuth);

  const plexAccount = (email: string) => ({
    MediaContainer: {
      User: [
        {
          $: {
            id: '777',
            title: 'erin',
            username: 'erin',
            email,
            thumb: 'https://plex.tv/erin.png',
          },
          Server: [],
        },
      ],
    },
  });

  it('adopts a local-only user with the same email', async () => {
    const local = await createUser({ email: 'erin@seerr.dev' });
    plexUsersMock.mock.mockImplementation(async () =>
      plexAccount('erin@seerr.dev')
    );
    const agent = await loginAs('admin@seerr.dev');

    const res = await agent.post('/user/import-from-plex').send();

    assert.strictEqual(res.status, 201);
    const user = await findUser(local.id);
    assert.strictEqual(user.plexId, 777);
    assert.strictEqual(user.plexUsername, 'erin');
    assert.strictEqual(user.userType, UserType.PLEX);
  });

  it('leaves a Jellyfin user with the same email untouched', async () => {
    const jellyfinUser = await createUser({
      email: 'erin@seerr.dev',
      jellyfinUserId: ERIN_ID,
      jellyfinUsername: 'erin',
      userType: UserType.JELLYFIN,
      avatar: `/avatarproxy/${ERIN_ID}`,
    });
    plexUsersMock.mock.mockImplementation(async () =>
      plexAccount('erin@seerr.dev')
    );
    const agent = await loginAs('admin@seerr.dev');

    const res = await agent.post('/user/import-from-plex').send();

    assert.strictEqual(res.status, 201);
    const user = await findUser(jellyfinUser.id);
    assert.strictEqual(user.plexId, null);
    assert.strictEqual(user.plexUsername, null);
    assert.strictEqual(user.avatar, `/avatarproxy/${ERIN_ID}`);
  });
});
