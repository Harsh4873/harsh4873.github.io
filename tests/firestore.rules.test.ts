import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-slate';
const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const OWNER_UID = 'slate-owner';
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

const ROOT_DOC = {
  schemaVersion: 1,
  settings: { theme: 'dark', hideCompleted: false, updatedAt: '2026-07-12T10:00:00.000Z' },
  updatedAt: '2026-07-12T10:00:00.000Z',
};

describe.skipIf(!EMULATOR_ADDRESS)('Slate Firestore security rules', () => {
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

  it('allows the verified Google owner to read and write the root and every collection', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID), ROOT_DOC));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'sections', 'section-1'), { id: 'section-1' }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'tasks', 'task-1'), { id: 'task-1' }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'blocks', 'block-1'), { id: 'block-1' }));
    await assertSucceeds(getDoc(doc(firestore, 'slate_users', OWNER_UID)));
  });

  it('rejects roots with an unexpected schema version', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    await assertFails(setDoc(doc(firestore, 'slate_users', OWNER_UID), { ...ROOT_DOC, schemaVersion: 99 }));
  });

  it('rejects other verified Google accounts', async () => {
    const firestore = authorizedContext(testEnvironment, OWNER_UID, { email: 'someone-else@gmail.com' }).firestore();
    await assertFails(getDoc(doc(firestore, 'slate_users', OWNER_UID)));
    await assertFails(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'tasks', 'task-1'), { id: 'task-1' }));
  });

  it('rejects the right email without verification or Google provider', async () => {
    const unverified = authorizedContext(testEnvironment, OWNER_UID, { email_verified: false }).firestore();
    await assertFails(getDoc(doc(unverified, 'slate_users', OWNER_UID)));

    const passwordProvider = authorizedContext(testEnvironment, OWNER_UID, { firebase: { sign_in_provider: 'password' } }).firestore();
    await assertFails(getDoc(doc(passwordProvider, 'slate_users', OWNER_UID)));
  });

  it('rejects a user reading a different uid, and anonymous access anywhere', async () => {
    const otherUid = authorizedContext(testEnvironment, 'someone-else').firestore();
    await assertFails(getDoc(doc(otherUid, 'slate_users', OWNER_UID)));

    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'slate_users', OWNER_UID)));
    await assertFails(setDoc(doc(anonymous, 'slate_users', OWNER_UID, 'tasks', 'task-1'), { id: 'task-1' }));
  });

  it('keeps authorized Daymark access working in the combined ruleset', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const root = doc(firestore, 'daymark_users', OWNER_UID);
    const habit = doc(firestore, 'daymark_users', OWNER_UID, 'habits', 'read');

    await assertSucceeds(setDoc(root, {
      generationId: 'generation-1',
      profileGenerationId: 'generation-1',
    }));
    await assertSucceeds(setDoc(habit, { generationId: 'generation-1', name: 'Read' }));
    await assertSucceeds(getDoc(root));
    await assertSucceeds(getDoc(habit));
  });

  it('still protects Daymark documents from anonymous access', async () => {
    const anonymous = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'daymark_users', 'daymark-owner')));
  });

  it('keeps authorized Fare access working in the combined ruleset', async () => {
    const firestore = authorizedContext(testEnvironment).firestore();
    const profile = doc(firestore, 'fare_users', OWNER_UID, 'profile', 'current');
    const entry = doc(firestore, 'fare_users', OWNER_UID, 'entries', 'entry-1');

    await assertSucceeds(setDoc(profile, { updatedAt: '2026-07-12T10:00:00.000Z' }));
    await assertSucceeds(setDoc(entry, {
      id: 'entry-1',
      updatedAt: '2026-07-12T10:00:00.000Z',
    }));
    await assertSucceeds(getDoc(profile));
    await assertSucceeds(getDoc(entry));
  });
});
