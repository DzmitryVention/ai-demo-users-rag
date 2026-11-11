import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { api } from './api.ts';

let authPromise: Promise<Auth> | undefined;

/**
 * Lazily initialises Firebase from /api/config, so the same build runs in every
 * environment without baking project settings into the bundle.
 */
export function getFirebaseAuth(): Promise<Auth> {
  authPromise ??= api.config().then(({ firebase }) => {
    const app: FirebaseApp = initializeApp(firebase);
    return getAuth(app);
  });
  return authPromise;
}

export function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}
