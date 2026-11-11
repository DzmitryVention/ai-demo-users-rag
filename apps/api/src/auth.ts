import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

/** Claims the API relies on, independent of the identity provider SDK. */
export interface VerifiedIdentity {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedIdentity>;
}

/**
 * Verifies Firebase ID tokens (signature via Google's public keys, audience,
 * issuer and expiry). Needs only the project id — no service-account key.
 */
export function createFirebaseVerifier(projectId: string): TokenVerifier {
  const app = getApps()[0] ?? initializeApp({ projectId });
  const auth = getAuth(app);

  return {
    async verify(idToken) {
      const decoded = await auth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email ?? '',
        emailVerified: decoded.email_verified === true,
        name: typeof decoded['name'] === 'string' ? decoded['name'] : null,
        picture: decoded.picture ?? null,
      };
    },
  };
}
