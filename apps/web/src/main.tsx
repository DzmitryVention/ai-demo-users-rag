import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { RequireRole } from './auth/guards.tsx';
import { AppShell } from './components/AppShell.tsx';
import { EmptyState, Spinner } from './components/ui/index.tsx';
import './index.css';
import { ApiError } from './lib/api.ts';
import { LandingPage } from './pages/LandingPage.tsx';

// Route-level code splitting: admin and help-desk bundles load on demand.
const AdminTicketPage = lazy(() =>
  import('./pages/admin/AdminTicketPage.tsx').then((m) => ({ default: m.AdminTicketPage })),
);
const AdminTicketsPage = lazy(() =>
  import('./pages/admin/TicketsPage.tsx').then((m) => ({ default: m.AdminTicketsPage })),
);
const UserDetailPage = lazy(() =>
  import('./pages/admin/UserDetailPage.tsx').then((m) => ({ default: m.UserDetailPage })),
);
const UsersPage = lazy(() =>
  import('./pages/admin/UsersPage.tsx').then((m) => ({ default: m.UsersPage })),
);
const HelpdeskPage = lazy(() =>
  import('./pages/helpdesk/HelpdeskPage.tsx').then((m) => ({ default: m.HelpdeskPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/helpdesk/ProfilePage.tsx').then((m) => ({ default: m.ProfilePage })),
);
const TicketPage = lazy(() =>
  import('./pages/helpdesk/TicketPage.tsx').then((m) => ({ default: m.TicketPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Don't retry auth/validation errors; do retry transient failures.
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  {
    element: <AppShell />,
    children: [
      {
        path: '/help',
        element: (
          <RequireRole role="user">
            <HelpdeskPage />
          </RequireRole>
        ),
      },
      {
        path: '/help/tickets/:id',
        element: (
          <RequireRole role="user">
            <TicketPage />
          </RequireRole>
        ),
      },
      {
        path: '/help/profile',
        element: (
          <RequireRole role="user">
            <ProfilePage />
          </RequireRole>
        ),
      },
      { path: '/admin', element: <Navigate to="/admin/users" replace /> },
      {
        path: '/admin/users',
        element: (
          <RequireRole role="admin">
            <UsersPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/users/:id',
        element: (
          <RequireRole role="admin">
            <UserDetailPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/tickets',
        element: (
          <RequireRole role="admin">
            <AdminTicketsPage />
          </RequireRole>
        ),
      },
      {
        path: '/admin/tickets/:id',
        element: (
          <RequireRole role="admin">
            <AdminTicketPage />
          </RequireRole>
        ),
      },
    ],
  },
  {
    path: '*',
    element: (
      <EmptyState icon={<span className="text-xl">?</span>} title="Page not found">
        <a href="/" className="text-brand-600 hover:underline">
          Go home
        </a>
      </EmptyState>
    ),
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Suspense fallback={<Spinner />}>
          <RouterProvider router={router} />
        </Suspense>
        <Toaster richColors closeButton position="top-right" />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
