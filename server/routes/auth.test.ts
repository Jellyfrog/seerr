import assert from 'node:assert/strict';
import { before, beforeEach, describe, it, mock } from 'node:test';

import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import PreparedEmail from '@server/lib/email';
import ImageProxy from '@server/lib/imageproxy';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import { ApiError } from '@server/types/error';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';

const emailMock = mock.method(PreparedEmail.prototype, 'send', async () => {
  return undefined;
}).mock;

// Jellyfin Quick Connect mocks
const defaultInitiateResponse = {
  Secret: 'abc123def456abc123def456',
  Code: '123456',
  DateAdded: new Date().toISOString(),
};

const defaultCheckResponse = {
  Authenticated: false,
  Secret: 'abc123def456abc123def456',
  Code: '123456',
  DeviceId: 'device-1',
  DeviceName: 'Test',
  AppName: 'Seerr',
  AppVersion: '1.0',
  DateAdded: new Date().toISOString(),
};

const defaultAuthenticateResponse = {
  User: {
    Id: 'jf-qc-user-001',
    Name: 'quickconnectuser',
    ServerId: 'server-1',
    Policy: { IsAdministrator: false },
  },
  AccessToken: 'fake-qc-access-token',
};

const initiateQCMock = mock.method(
  JellyfinAPI.prototype,
  'initiateQuickConnect',
  async () => ({ ...defaultInitiateResponse })
);

const checkQCMock = mock.method(
  JellyfinAPI.prototype,
  'checkQuickConnect',
  async () => ({ ...defaultCheckResponse })
);

const authenticateQCMock = mock.method(
  JellyfinAPI.prototype,
  'authenticateQuickConnect',
  async () => ({ ...defaultAuthenticateResponse })
);
const fakeAvatarBuffer = Buffer.from('fake-quickconnect-avatar-bytes');

const axiosHeadMock = mock.method(axios, 'head', async () => ({
  status: 200,
  headers: { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
}));

const clearCachedImageMock = mock.method(
  ImageProxy.prototype,
  'clearCachedImage',
  async () => undefined
);

const getImageMock = mock.method(
  ImageProxy.prototype,
  'getImage',
  async () => ({
    imageBuffer: fakeAvatarBuffer,
    meta: {
      revalidateAfter: 3600,
      curRevalidate: 3600,
      isStale: false,
      etag: 'mock-meta-etag',
      extension: 'jpg',
      cacheKey: 'mock-cache-key',
      cacheMiss: true,
    },
  })
);

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
  // Error handler matching how next({ status, message }) calls are handled
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // We must provide a next function for the function signature here even though its not used
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

/** Create a supertest agent that is logged in as the given user. */
async function authenticatedAgent(email: string, password: string) {
  const agent = request.agent(app);
  const settings = getSettings();
  settings.main.localLogin = true;

  const res = await agent.post('/auth/local').send({ email, password });

  assert.strictEqual(res.status, 200);
  return agent;
}

/** Configure Jellyfin settings for testing QC */
function configureJellyfin() {
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.JELLYFIN;
  settings.main.newPlexLogin = true;
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
  settings.main.jellyfinLogin = true;
  settings.plex.ip = 'plex.local';
  settings.plex.machineId = 'machine-1';
}

/** Plex is the media backend, with Jellyfin configured only for sign-in. */
function plexBackendWithJellyfinAuth() {
  jellyfinBackendWithPlexAuth();
  const settings = getSettings();
  settings.main.mediaServerType = MediaServerType.PLEX;
  settings.jellyfin.serverType = MediaServerType.JELLYFIN;
}

describe('POST /auth/jellyfin/quickconnect/initiate', () => {
  beforeEach(() => {
    initiateQCMock.mock.resetCalls();
    initiateQCMock.mock.mockImplementation(async () => ({
      ...defaultInitiateResponse,
    }));
    configureJellyfin();
  });

  it('returns code and secret on success', async () => {
    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.code, '123456');
    assert.strictEqual(res.body.secret, 'abc123def456abc123def456');
    assert.strictEqual(initiateQCMock.mock.callCount(), 1);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 403);
    assert.strictEqual(initiateQCMock.mock.callCount(), 0);
  });

  it('returns 500 when Jellyfin API fails', async () => {
    initiateQCMock.mock.mockImplementation(async () => {
      throw new Error('Connection refused');
    });

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');

    assert.strictEqual(res.status, 500);
    assert.match(res.body.message, /initiate quick connect/i);
  });

  it('returns 500 when initiateQuickConnect throws ApiError', async () => {
    initiateQCMock.mock.mockImplementation(async () => {
      throw new ApiError(500, ApiErrorCode.Unknown);
    });

    const res = await request(app).post('/auth/jellyfin/quickconnect/initiate');
    assert.strictEqual(res.status, 500);
  });
});

describe('GET /auth/jellyfin/quickconnect/check', () => {
  beforeEach(() => {
    checkQCMock.mock.resetCalls();
    checkQCMock.mock.mockImplementation(async () => ({
      ...defaultCheckResponse,
    }));
    configureJellyfin();
  });

  it('returns authenticated: false when not yet authorized', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authenticated, false);
    assert.strictEqual(checkQCMock.mock.callCount(), 1);
  });

  it('returns authenticated: true when authorized', async () => {
    checkQCMock.mock.mockImplementation(async () => ({
      ...defaultCheckResponse,
      Authenticated: true,
    }));

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.authenticated, true);
  });

  it('returns 400 when secret is missing', async () => {
    const res = await request(app).get('/auth/jellyfin/quickconnect/check');

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too short', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'ab12' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too long', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'a'.repeat(129) });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret contains non-hex characters', async () => {
    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'zzzzzzzzzzzz' });

    assert.strictEqual(res.status, 400);
    assert.match(res.body.message, /invalid secret/i);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(checkQCMock.mock.callCount(), 0);
  });

  it('returns error when Jellyfin API fails', async () => {
    checkQCMock.mock.mockImplementation(async () => {
      throw new ApiError(500, ApiErrorCode.Unknown);
    });

    const res = await request(app)
      .get('/auth/jellyfin/quickconnect/check')
      .query({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 500);
  });
});

describe('POST /auth/jellyfin/quickconnect/authenticate', () => {
  beforeEach(() => {
    authenticateQCMock.mock.resetCalls();
    authenticateQCMock.mock.mockImplementation(async () => ({
      ...defaultAuthenticateResponse,
    }));
    axiosHeadMock.mock.resetCalls();
    clearCachedImageMock.mock.resetCalls();
    getImageMock.mock.resetCalls();
    configureJellyfin();
  });

  it('returns 400 when secret is missing', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({});

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is not a string', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 12345678 });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 400 when secret is too short', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'ab12' });

    assert.strictEqual(res.status, 400);
  });

  it('returns 400 when secret contains non-hex characters', async () => {
    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'zzzzzzzzzzzz' });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 403 when media server is not configured', async () => {
    const settings = getSettings();
    settings.main.mediaServerType = MediaServerType.NOT_CONFIGURED;

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /initial setup/i);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('returns 403 when no users exist in the database', async () => {
    // Clear all users to simulate initial setup
    const userRepo = getRepository(User);
    await userRepo.clear();

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.match(res.body.message, /initial setup/i);
  });

  it('signs in an existing Jellyfin user and sets session', async () => {
    const userRepo = getRepository(User);
    const existingUser = new User({
      email: 'existing-qc@seerr.dev',
      jellyfinUsername: 'quickconnectuser',
      jellyfinUserId: 'jf-qc-user-001',
      jellyfinDeviceId: 'old-device-id',
      permissions: 0,
      avatar: '/avatarproxy/jf-qc-user-001?v=0',
      userType: UserType.JELLYFIN,
    });
    await userRepo.save(existingUser);

    const agent = request.agent(app);

    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    assert.ok(!('password' in res.body));

    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.jellyfinUsername, 'quickconnectuser');

    const updatedUser = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-qc-user-001' },
      select: {
        id: true,
        jellyfinAuthToken: true,
        jellyfinDeviceId: true,
      },
    });
    assert.strictEqual(updatedUser.jellyfinAuthToken, 'fake-qc-access-token');
    assert.notStrictEqual(updatedUser.jellyfinDeviceId, 'old-device-id');
  });

  it('refreshes avatarVersion/avatarETag when the remote avatar has changed', async () => {
    const userRepo = getRepository(User);
    const existingUser = new User({
      email: 'qc-avatar-change@seerr.dev',
      jellyfinUsername: 'quickconnectuser',
      jellyfinUserId: 'jf-qc-user-001',
      jellyfinDeviceId: 'old-device-id',
      permissions: 0,
      avatar: '/avatarproxy/jf-qc-user-001?v=old',
      avatarVersion: 'old-version',
      avatarETag: 'old-etag',
      userType: UserType.JELLYFIN,
    });
    await userRepo.save(existingUser);

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);

    const updatedUser = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-qc-user-001' },
    });
    assert.notStrictEqual(updatedUser.avatarVersion, 'old-version');
    assert.notStrictEqual(updatedUser.avatarETag, 'old-etag');
    assert.notStrictEqual(
      updatedUser.avatar,
      '/avatarproxy/jf-qc-user-001?v=old'
    );
  });

  it('creates a new user when newPlexLogin is enabled and user does not exist', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = true;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-brand-new-user',
        Name: 'brandnewuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'new-user-token',
    }));

    const agent = request.agent(app);

    const res = await agent
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);

    const userRepo = getRepository(User);
    const newUser = await userRepo.findOne({
      where: { jellyfinUserId: 'jf-brand-new-user' },
    });
    assert.ok(newUser);
    assert.strictEqual(newUser.jellyfinUsername, 'brandnewuser');
    assert.strictEqual(newUser.userType, UserType.JELLYFIN);

    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
  });

  it('returns 403 when the media server is Emby', async () => {
    getSettings().main.mediaServerType = MediaServerType.EMBY;

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(authenticateQCMock.mock.callCount(), 0);
  });

  it('applies default permissions to newly created users', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = true;
    settings.main.defaultPermissions = 32;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-perms-test-user',
        Name: 'permsuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'perms-token',
    }));

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 200);

    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { jellyfinUserId: 'jf-perms-test-user' },
    });
    assert.strictEqual(user.permissions, 32);
  });

  it('returns 403 when newPlexLogin is disabled and user does not exist', async () => {
    const settings = getSettings();
    settings.main.newPlexLogin = false;

    authenticateQCMock.mock.mockImplementation(async () => ({
      User: {
        Id: 'jf-unknown-user',
        Name: 'unknownuser',
        ServerId: 'server-1',
        Policy: { IsAdministrator: false },
      },
      AccessToken: 'unknown-token',
    }));

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns error when Jellyfin authenticateQuickConnect fails', async () => {
    authenticateQCMock.mock.mockImplementation(async () => {
      throw new ApiError(401, ApiErrorCode.InvalidCredentials);
    });

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.message, ApiErrorCode.InvalidCredentials);
  });

  it('returns 500 when Jellyfin throws a generic error', async () => {
    authenticateQCMock.mock.mockImplementation(async () => {
      throw new Error('Network timeout');
    });

    const res = await request(app)
      .post('/auth/jellyfin/quickconnect/authenticate')
      .send({ secret: 'abc123def456abc123def456' });

    assert.strictEqual(res.status, 500);
  });
});

describe('GET /auth/me', () => {
  it('returns 403 when not authenticated', async () => {
    const res = await request(app).get('/auth/me');
    assert.strictEqual(res.status, 403);
  });

  it('returns the authenticated user', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    assert.strictEqual(res.body.displayName, 'admin');
  });

  it('includes userEmailRequired warning when email is required but invalid', async () => {
    const settings = getSettings();
    settings.notifications.agents.email.options.userEmailRequired = true;

    // Change the user's email to something invalid
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.email = 'not-an-email';
    await userRepo.save(user);

    // Log in with the changed email
    const agent = request.agent(app);
    settings.main.localLogin = true;
    const loginRes = await agent
      .post('/auth/local')
      .send({ email: 'not-an-email', password: 'test1234' });
    assert.strictEqual(loginRes.status, 200);

    const res = await agent.get('/auth/me');

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.warnings.includes('userEmailRequired'));

    settings.notifications.agents.email.options.userEmailRequired = false;
  });
});

describe('POST /auth/local', () => {
  beforeEach(() => {
    const settings = getSettings();
    settings.main.localLogin = true;
  });

  it('returns 200 and user data on valid credentials', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
    // filter() strips sensitive fields like password
    assert.ok(!('password' in res.body));
  });

  it('returns 403 on wrong password', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'wrongpassword' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns 403 for nonexistent user', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'nobody@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.message, 'Access denied.');
  });

  it('returns 500 when local login is disabled', async () => {
    const settings = getSettings();
    settings.main.localLogin = false;

    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, 'Password sign-in is disabled.');
  });

  it('returns 500 when email is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ password: 'test1234' });

    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /email address and a password/);
  });

  it('returns 500 when password is missing', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 500);
    assert.match(res.body.error, /email address and a password/);
  });

  it('is case-insensitive for email', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'Admin@Seerr.Dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('allows the non-admin user to log in', async () => {
    const res = await request(app)
      .post('/auth/local')
      .send({ email: 'friend@seerr.dev', password: 'test1234' });

    assert.strictEqual(res.status, 200);
    assert.ok('id' in res.body);
  });

  it('sets a session on successful login', async () => {
    const agent = request.agent(app);

    await agent
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });

    // Session should persist — /me should succeed
    const meRes = await agent.get('/auth/me');
    assert.strictEqual(meRes.status, 200);
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 when not logged in', async () => {
    const res = await request(app).post('/auth/logout');

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
  });

  it('destroys session and returns 200 when logged in', async () => {
    const agent = await authenticatedAgent('admin@seerr.dev', 'test1234');

    // Verify session is active
    const meBeforeRes = await agent.get('/auth/me');
    assert.strictEqual(meBeforeRes.status, 200);

    const logoutRes = await agent.post('/auth/logout');
    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.status, 'ok');

    // Session should be invalidated — /me should fail
    const meAfterRes = await agent.get('/auth/me');
    assert.strictEqual(meAfterRes.status, 403);
  });
});

describe('POST /auth/reset-password', () => {
  beforeEach(() => {
    emailMock.resetCalls();
  });

  it('returns 200 for a valid email', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 1);
  });

  it('returns 200 for nonexistent email (does not reveal user existence)', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'nonexistent@seerr.dev' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('returns 500 when email is missing', async () => {
    const res = await request(app).post('/auth/reset-password').send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Email address required.');
    assert.strictEqual(emailMock.callCount(), 0);
  });

  it('sets a resetPasswordGuid on the user', async () => {
    await request(app)
      .post('/auth/reset-password')
      .send({ email: 'admin@seerr.dev' });

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect(['user.resetPasswordGuid', 'user.recoveryLinkExpirationDate'])
      .where('user.email = :email', { email: 'admin@seerr.dev' })
      .getOneOrFail();

    assert.notStrictEqual(user.resetPasswordGuid, undefined);
    assert.notStrictEqual(user.resetPasswordGuid, null);
    assert.notStrictEqual(user.recoveryLinkExpirationDate, undefined);
    assert.strictEqual(emailMock.callCount(), 1);
  });
});

describe('POST /auth/reset-password/:guid', () => {
  /** Trigger a password reset and return the guid. */
  async function getResetGuid(email: string): Promise<string> {
    await request(app).post('/auth/reset-password').send({ email });

    const userRepo = getRepository(User);
    const user = await userRepo
      .createQueryBuilder('user')
      .addSelect('user.resetPasswordGuid')
      .where('user.email = :email', { email })
      .getOneOrFail();

    return user.resetPasswordGuid!;
  }

  it('resets password with a valid guid and password', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');

    // Old password no longer works
    const oldLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'test1234' });
    assert.strictEqual(oldLogin.status, 403);

    // New password works
    const newLogin = await request(app)
      .post('/auth/local')
      .send({ email: 'admin@seerr.dev', password: 'newpassword123' });
    assert.strictEqual(newLogin.status, 200);
  });

  it('returns 500 for an invalid guid', async () => {
    const res = await request(app)
      .post('/auth/reset-password/invalid-guid-here')
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('returns 500 when password is too short', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'short' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('returns 500 when password is missing', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({});

    assert.strictEqual(res.status, 500);
    assert.strictEqual(
      res.body.message,
      'Password must be at least 8 characters long.'
    );
  });

  it('returns 500 for an expired recovery link', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // Expire the link
    const userRepo = getRepository(User);
    const user = await userRepo.findOneOrFail({
      where: { email: 'admin@seerr.dev' },
    });
    user.recoveryLinkExpirationDate = new Date('2020-01-01');
    await userRepo.save(user);

    const res = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.message, 'Invalid password reset link.');
  });

  it('cannot reuse a guid after successful reset', async () => {
    const guid = await getResetGuid('admin@seerr.dev');

    // First reset succeeds
    const first = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'newpassword123' });
    assert.strictEqual(first.status, 200);

    // Second reset with same guid fails (recoveryLinkExpirationDate was cleared)
    const second = await request(app)
      .post(`/auth/reset-password/${guid}`)
      .send({ password: 'anotherpassword' });
    assert.strictEqual(second.status, 500);
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

    assert.strictEqual(res.status, 500);
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
});
