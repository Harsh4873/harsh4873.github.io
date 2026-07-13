import { getApps, initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// Fare shares the pickledgerpro Firebase project with Daymark and Slate, but
// its named app keeps auth and persistent Firestore cache isolated on the
// shared harsh.bet origin.
const APP_NAME = 'fare';

const firebaseConfig = {
  apiKey: 'AIzaSyATQK7NHNXIshlJIy7xT17z8Kr8fUWatLs',
  authDomain: 'pickledgerpro.firebaseapp.com',
  projectId: 'pickledgerpro',
  storageBucket: 'pickledgerpro.firebasestorage.app',
  messagingSenderId: '285462656063',
  appId: '1:285462656063:web:caa084d1daf04e04eab48a',
};

export const firebaseApp = getApps().find((app) => app.name === APP_NAME)
  ?? initializeApp(firebaseConfig, APP_NAME);

export const firebaseAuth = getAuth(firebaseApp);
export const authPersistenceReady = setPersistence(firebaseAuth, browserLocalPersistence);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  login_hint: 'hdav4873@gmail.com',
  prompt: 'select_account',
});

export const fareFirestore = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
