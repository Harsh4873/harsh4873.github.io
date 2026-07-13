import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-fare';
const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const OWNER_UID = 'fare-owner';
const EMULATOR_ADDRESS = process.env.FIRESTORE_EMULATOR_HOST;
const STAMP = '2026-07-12T10:00:00.000Z';

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

describe.skipIf(!EMULATOR_ADDRESS)('combined Firestore security rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = EMULATOR_ADDRESS!.split(':');
    const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host, port: Number(rawPort), rules },
    });
  });

  afterEach(async () => testEnvironment.clearFirestore());
  afterAll(async () => testEnvironment.cleanup());

  it('allows the verified Google owner to use every Fare document family', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    for (const name of ['profile', 'targets', 'settings']) {
      const reference = doc(firestore, 'fare_users', OWNER_UID, name, 'current');
      await assertSucceeds(setDoc(reference, { updatedAt: STAMP }));
      await assertSucceeds(getDoc(reference));
    }
    for (const name of ['foods', 'meals', 'entries']) {
      const reference = doc(firestore, 'fare_users', OWNER_UID, name, 'record-1');
      await assertSucceeds(setDoc(reference, { id: 'record-1', updatedAt: STAMP }));
      await assertSucceeds(getDoc(reference));
      await assertSucceeds(getDocs(collection(firestore, 'fare_users', OWNER_UID, name)));
      await assertSucceeds(setDoc(reference, {
        id: 'record-1',
        updatedAt: STAMP,
        deleted: true,
        deletedAt: STAMP,
      }));
    }
  });

  it('requires current singleton ids, matching entity ids, timestamps, and tombstones instead of deletes', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'profile', 'extra'), { updatedAt: STAMP }));
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1'), { id: 'different', updatedAt: STAMP }));
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1'), { id: 'food-1' }));
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1'), { id: 'food-1', updatedAt: STAMP, deleted: true }));
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1'), { id: 'food-1', updatedAt: STAMP, deleted: false }));
    const reference = doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1');
    await assertSucceeds(setDoc(reference, { id: 'food-1', updatedAt: STAMP }));
    await assertSucceeds(setDoc(reference, {
      id: 'food-1',
      updatedAt: '2026-07-12T11:00:00.000Z',
      deleted: true,
      deletedAt: '2026-07-12T11:00:00.000Z',
    }));
    await assertFails(setDoc(reference, {
      id: 'food-1',
      updatedAt: '2026-07-12T10:30:00.000Z',
    }));
    await assertFails(deleteDoc(reference));
  });

  it('rejects other accounts, wrong uids, unverified users, non-Google providers, and anonymous access', async () => {
    const wrongEmail = authorizedContext(testEnvironment, OWNER_UID, { email: 'someone@example.com' }).firestore();
    await assertFails(getDoc(doc(wrongEmail, 'fare_users', OWNER_UID, 'profile', 'current')));

    const wrongUid = authorizedContext(testEnvironment, 'someone-else').firestore();
    await assertFails(getDoc(doc(wrongUid, 'fare_users', OWNER_UID, 'foods', 'food-1')));

    const unverified = authorizedContext(testEnvironment, OWNER_UID, { email_verified: false }).firestore();
    await assertFails(getDoc(doc(unverified, 'fare_users', OWNER_UID, 'profile', 'current')));

    const password = authorizedContext(testEnvironment, OWNER_UID, { firebase: { sign_in_provider: 'password' } }).firestore();
    await assertFails(getDoc(doc(password, 'fare_users', OWNER_UID, 'profile', 'current')));

    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'fare_users', OWNER_UID, 'entries', 'entry-1')));
  });

  it('does not expose a Fare root document or unknown collections', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    await assertFails(getDoc(doc(firestore, 'fare_users', OWNER_UID)));
    await assertFails(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'private', 'record'), { updatedAt: STAMP }));
  });

  it('preserves authorized Daymark and Slate access in the shared ruleset', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    await assertSucceeds(setDoc(doc(firestore, 'daymark_users', OWNER_UID), {
      generationId: 'generation-1',
      profileGenerationId: 'generation-1',
    }));
    await assertSucceeds(setDoc(doc(firestore, 'daymark_users', OWNER_UID, 'habits', 'read'), { name: 'Read' }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID), {
      schemaVersion: 1,
      settings: { updatedAt: STAMP },
      updatedAt: STAMP,
    }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'tasks', 'task-1'), { id: 'task-1' }));
  });
});
