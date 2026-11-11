import type { Role } from '@app/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Spinner } from '../components/ui/index.tsx';
import { useAuth } from './AuthProvider.tsx';

export const homeFor = (role: Role) => (role === 'admin' ? '/admin/users' : '/help');

/**
 * Client-side routing guard. This is UX only — the API enforces authorization
 * on every request (constitution §3).
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { status, me } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Spinner />;
  if (status === 'signed-out' || !me) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  if (me.role !== role) return <Navigate to={homeFor(me.role)} replace />;
  return children;
}
