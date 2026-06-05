import { initializeApp } from 'firebase/app';
import { getAuth, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { doc, getDoc, getFirestore, increment, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';

declare global {
  interface Window {
    _firebaseDb: unknown;
    _firebaseDoc: typeof doc;
    _firebaseGetDoc: typeof getDoc;
    _firebaseSetDoc: typeof setDoc;
    _firebaseUpdateDoc: typeof updateDoc;
  }
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

window._firebaseDb = db;
window._firebaseDoc = doc;
window._firebaseGetDoc = getDoc;
window._firebaseSetDoc = setDoc;
window._firebaseUpdateDoc = updateDoc;

export {
  doc,
  getDoc,
  increment,
  getRedirectResult,
  onAuthStateChanged,
  onSnapshot,
  setDoc,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateDoc,
};
