import {
  describeIdentityHttpContract,
  describeIdentityPortContract,
} from '@atlasbi/contracts/testing';

import { createBetterAuthHttp, createBetterAuthIdentity } from '../../src/index.ts';
import { createAuthDatabase, testSecret } from './support/auth-database.ts';
import { platformIdentityView } from './support/platform-identity-view.ts';

// The batteries any identity provider must pass to replace better-auth (docs/21 §3.3). Each
// deployment is a throwaway database with its own secret: its own users and keys.
describeIdentityPortContract('better-auth', {
  async create() {
    const database = await createAuthDatabase();
    const identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret: testSecret(),
    });
    const platform = platformIdentityView(database.connectionString);
    return {
      identity,
      platform,
      async dispose() {
        await platform.close();
        await identity.close();
        await database.drop();
      },
    };
  },
});

describeIdentityHttpContract('better-auth', {
  async create({ publicUrl }) {
    const database = await createAuthDatabase();
    const secret = testSecret();
    const identity = createBetterAuthIdentity({
      connectionString: database.connectionString,
      secret,
    });
    const account = { email: 'ana@example.com', password: 'correct horse battery staple' };
    const { userId } = await identity.createUser({ ...account, name: 'Ana' });
    await identity.createOrganization({ name: 'Demo', slug: 'demo', ownerUserId: userId });
    const http = createBetterAuthHttp({
      connectionString: database.connectionString,
      secret,
      publicUrl,
    });
    return {
      http,
      account,
      verifyIdentityToken: (token) => identity.verifyIdentityToken(token),
      async dispose() {
        await http.close();
        await identity.close();
        await database.drop();
      },
    };
  },
});
