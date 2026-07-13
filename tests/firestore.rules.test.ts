import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-daymark';
const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const OWNER_UID = 'daymark-owner';
const EMULATOR_ADDRESS = process.env.FIRESTORE_EMULATOR_HOST;

function authorizedContext(
  testEnvironment: RulesTestEnvironment,
  uid = OWNER_UID,
  overrides: Record<string, unknown> = {},
): RulesTestContext {
  return testEnvironment.authenticatedContext(uid, {
    email: ALLOWED_EMAIL,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  });
}

describe.skipIf(!EMULATOR_ADDRESS)('Daymark Firestore security rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = EMULATOR_ADDRESS!.split(':');
    const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');

    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host,
        port: Number(rawPort),
        rules,
      },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment.cleanup();
  });

  it('allows the verified Google owner to read and write the root, habits, and entries', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const root = doc(firestore, 'daymark_users', OWNER_UID);
    const habit = doc(firestore, 'daymark_users', OWNER_UID, 'habits', 'read');
    const entry = doc(firestore, 'daymark_users', OWNER_UID, 'entries', '2026-07-11__read');

    await assertSucceeds(setDoc(root, {
      generationId: 'generation-1',
      profileGenerationId: 'generation-1',
      schemaVersion: 2,
    }));
    await assertSucceeds(setDoc(habit, { generationId: 'generation-1', name: 'Read' }));
    await assertSucceeds(setDoc(entry, { generationId: 'generation-1', value: 20 }));
    await assertSucceeds(getDoc(root));
    await assertSucceeds(getDoc(habit));
    await assertSucceeds(getDoc(entry));
    await assertSucceeds(updateDoc(root, {
      profile: { displayName: 'Harsh' },
      updatedAt: '2026-07-11T12:00:00.000Z',
      profileGenerationId: 'generation-1',
    }));
    await assertSucceeds(deleteDoc(entry));
  });

  it('keeps independent entry documents and lets the last write win on the same entry', async () => {
    const phone = authorizedContext(testEnvironment).firestore();
    const laptop = authorizedContext(testEnvironment).firestore();
    const phoneEntry = doc(phone, 'daymark_users', OWNER_UID, 'entries', '2026-07-11__read');
    const laptopEntry = doc(laptop, 'daymark_users', OWNER_UID, 'entries', '2026-07-11__steps');

    await assertSucceeds(setDoc(phoneEntry, { generationId: 'generation-1', value: 10 }));
    await assertSucceeds(setDoc(laptopEntry, { generationId: 'generation-1', value: 5000 }));
    await assertSucceeds(getDoc(phoneEntry));
    await assertSucceeds(getDoc(laptopEntry));

    await assertSucceeds(setDoc(phoneEntry, { generationId: 'generation-1', value: 20 }));
    await assertSucceeds(setDoc(doc(laptop, phoneEntry.path), { generationId: 'generation-1', value: 30 }));
    const finalEntry = await getDoc(phoneEntry);

    if (finalEntry.data()?.value !== 30) throw new Error('The final same-document write was not retained.');
  });

  it('denies signed-out access', async () => {
    const firestore = testEnvironment.unauthenticatedContext().firestore();
    const root = doc(firestore, 'daymark_users', OWNER_UID);

    await assertFails(getDoc(root));
    await assertFails(setDoc(root, { generationId: 'generation-1' }));
  });

  it('rejects a stale profile write after the root generation changes', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const root = doc(firestore, 'daymark_users', OWNER_UID);
    await assertSucceeds(setDoc(root, {
      generationId: 'generation-new',
      profileGenerationId: 'generation-new',
      profile: { displayName: 'Current' },
    }));

    await assertFails(updateDoc(root, {
      profile: { displayName: 'Stale offline device' },
      profileGenerationId: 'generation-old',
    }));
  });

  it('denies an authenticated user from another UID', async () => {
    const firestore = authorizedContext(testEnvironment, 'different-user').firestore();

    await assertFails(
      setDoc(doc(firestore, 'daymark_users', OWNER_UID, 'habits', 'read'), { name: 'Read' }),
    );
  });

  it('denies the owner UID when the email is not the approved account', async () => {
    const firestore = authorizedContext(testEnvironment, OWNER_UID, {
      email: 'someone-else@example.com',
    }).firestore();

    await assertFails(getDoc(doc(firestore, 'daymark_users', OWNER_UID)));
  });

  it('denies an unverified approved email', async () => {
    const firestore = authorizedContext(testEnvironment, OWNER_UID, {
      email_verified: false,
    }).firestore();

    await assertFails(
      setDoc(doc(firestore, 'daymark_users', OWNER_UID, 'entries', '2026-07-11__read'), {
        value: 1,
      }),
    );
  });

  it('denies the approved email when it did not sign in with Google', async () => {
    const firestore = authorizedContext(testEnvironment, OWNER_UID, {
      firebase: { sign_in_provider: 'password' },
    }).firestore();

    await assertFails(getDoc(doc(firestore, 'daymark_users', OWNER_UID)));
  });

  it('denies access to every non-Daymark collection', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const legacyUser = doc(firestore, 'users', OWNER_UID);
    const legacyPick = doc(firestore, 'picks', 'pick-1');

    await assertFails(getDoc(legacyUser));
    await assertFails(setDoc(legacyUser, { email: ALLOWED_EMAIL }));
    await assertFails(getDoc(legacyPick));
    await assertFails(setDoc(legacyPick, { result: 'win' }));
  });

  it('denies undeclared subcollections inside the owner namespace', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const unexpected = doc(firestore, 'daymark_users', OWNER_UID, 'private', 'anything');

    await assertFails(getDoc(unexpected));
    await assertFails(setDoc(unexpected, { value: 'not allowed' }));
  });

  it('keeps authorized Slate access working in the combined ruleset', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const root = doc(firestore, 'slate_users', OWNER_UID);
    const task = doc(firestore, 'slate_users', OWNER_UID, 'tasks', 'task-1');

    await assertSucceeds(setDoc(root, { schemaVersion: 1 }));
    await assertSucceeds(setDoc(task, { id: 'task-1' }));
    await assertSucceeds(getDoc(root));
    await assertSucceeds(getDoc(task));
  });
});
