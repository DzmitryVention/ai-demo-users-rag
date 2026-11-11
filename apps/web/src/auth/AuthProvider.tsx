import type { Me } from '@app/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  onIdTokenChanged,
  signInWithPopup,
  signOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setTokenProvider } from '../lib/api.ts';
import { getFirebaseAuth, googleProvider } from '../lib/firebase.ts';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  me: Me | undefined;
  error: unknown;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null | undefined>(undefined);
  const [initError, setInitError] = useState<unknown>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    getFirebaseAuth()
      .then((auth) => {
        // getIdToken() transparently refreshes tokens close to expiry.
        setTokenProvider(async () => auth.currentUser?.getIdToken() ?? null);
        unsubscribe = onIdTokenChanged(auth, setFirebaseUser);
      })
      .catch((err: unknown) => {
        setInitError(err);
        setFirebaseUser(null);
      });
    return () => unsubscribe?.();
  }, []);

  const meQuery = useQuery({
    queryKey: ['me', firebaseUser?.uid],
    queryFn: api.me,
    enabled: !!firebaseUser,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const handleSignIn = useCallback(async () => {
    const auth = await getFirebaseAuth();
    await signInWithPopup(auth, googleProvider());
  }, []);

  const handleSignOut = useCallback(async () => {
    const auth = await getFirebaseAuth();
    await signOut(auth);
    queryClient.clear();
  }, [queryClient]);

  const status: AuthStatus =
    firebaseUser === undefined || (firebaseUser && meQuery.isPending)
      ? 'loading'
      : firebaseUser && meQuery.data
        ? 'signed-in'
        : 'signed-out';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      me: meQuery.data,
      error: initError ?? meQuery.error,
      signIn: handleSignIn,
      signOut: handleSignOut,
    }),
    [status, meQuery.data, meQuery.error, initError, handleSignIn, handleSignOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
