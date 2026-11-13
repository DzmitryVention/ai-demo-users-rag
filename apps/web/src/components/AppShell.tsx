import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Bot, Inbox, LifeBuoy, LogOut, Moon, Sun, UserRound, Users } from 'lucide-react';
import { Suspense, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { api } from '../lib/api.ts';
import { fullName } from '../lib/format.ts';
import { Avatar, Spinner } from './ui/index.tsx';

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
    setDark(next);
  };
  return { dark, toggle };
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function Logo() {
  return (
    <span className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
        <LifeBuoy className="size-5" aria-hidden />
      </span>
      {/* Full name from the small breakpoint up; short name on phones. */}
      <span className="hidden truncate sm:inline">Renault Duster help desk</span>
      <span className="truncate sm:hidden">Duster help desk</span>
    </span>
  );
}

const navItem = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  );

export function AppShell() {
  const { status, me, signOut } = useAuth();
  const location = useLocation();
  // Badge with the number of requests waiting for a person (spec AC-3.1).
  const overview = useQuery({
    queryKey: ['admin', 'bot', 'overview'],
    queryFn: api.admin.botOverview,
    enabled: me?.role === 'admin',
    refetchInterval: 60_000,
  });
  const pendingHuman = overview.data?.pendingHuman ?? 0;
  if (status === 'loading') return <Spinner label="Checking your session" />;
  if (!me) return <Navigate to="/" replace state={{ from: location.pathname }} />;
  const isAdmin = me.role === 'admin';

  const links = isAdmin
    ? [
        { to: '/admin/users', label: 'Users', icon: Users },
        { to: '/admin/tickets', label: 'Requests', icon: Inbox, badge: pendingHuman },
        { to: '/admin/assistant', label: 'Assistant', icon: Bot },
      ]
    : [
        { to: '/help', label: 'My requests', icon: Inbox },
        { to: '/help/profile', label: 'Profile', icon: UserRound },
      ];

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Logo />
          {isAdmin && (
            <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-medium text-white">
              Admin
            </span>
          )}
          <nav aria-label="Main" className="flex items-center gap-1">
            {links.map((link) => {
              const Icon = link.icon;
              const badge = ('badge' in link ? link.badge : 0) ?? 0;
              return (
                <NavLink key={link.to} to={link.to} end={link.to === '/help'} className={navItem}>
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{link.label}</span>
                  {badge > 0 && (
                    <span
                      className="rounded-full bg-violet-600 px-1.5 text-[10px] leading-4 font-semibold text-white"
                      title={`${badge} request(s) need a human reply`}
                    >
                      {badge}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <div className="hidden items-center gap-2 md:flex">
              <Avatar name={fullName(me)} src={me.avatarUrl} size="sm" />
              <div className="text-sm leading-tight">
                <div className="font-medium">{fullName(me)}</div>
                <div className="text-xs text-slate-500">{me.email}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
