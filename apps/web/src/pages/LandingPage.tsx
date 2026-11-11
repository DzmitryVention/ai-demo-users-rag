import { FirebaseError } from 'firebase/app';
import { MessagesSquare, ShieldCheck, Zap } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '../auth/AuthProvider.tsx';
import { homeFor } from '../auth/guards.tsx';
import { Logo, ThemeToggle } from '../components/AppShell.tsx';
import { Button, ErrorState, Spinner } from '../components/ui/index.tsx';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.46 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

const features = [
  {
    icon: MessagesSquare,
    title: 'Talk to support',
    text: 'Open a request and follow the whole conversation in one place.',
  },
  {
    icon: Zap,
    title: 'Fast answers',
    text: 'Our team is notified instantly and replies right in the thread.',
  },
  {
    icon: ShieldCheck,
    title: 'Secure by Google',
    text: 'Sign in with your Google account — no new password to remember.',
  },
];

export function LandingPage() {
  const { status, me, error, signIn, signOut } = useAuth();
  const location = useLocation();
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <Spinner label="Checking your session" />;
  if (status === 'signed-in' && me) {
    const from = (location.state as { from?: string } | null)?.from;
    const target =
      from && from.startsWith(me.role === 'admin' ? '/admin' : '/help') ? from : homeFor(me.role);
    return <Navigate to={target} replace />;
  }

  const handleSignIn = async () => {
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/popup-closed-by-user') return;
      toast.error('Sign-in failed', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative isolate min-h-dvh overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 -top-40 -z-10 transform-gpu blur-3xl sm:-top-80"
      >
        <div className="relative left-1/2 aspect-[1155/678] w-[72rem] -translate-x-1/2 bg-gradient-to-tr from-brand-500 to-fuchsia-400 opacity-20 dark:opacity-25 [clip-path:polygon(74%_44%,100%_61%,97%_26%,85%_0%,80%_2%,72%_32%,60%_62%,52%_68%,47%_58%,45%_34%,27%_76%,0%_64%,17%_100%,27%_76%,76%_97%,74%_44%)]" />
      </div>

      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-3xl px-6 pt-16 pb-24 text-center sm:pt-24">
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
          How can we help you today?
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-pretty text-slate-600 dark:text-slate-400">
          Sign in with Google to reach our support team, track your requests and keep your profile
          up to date.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4">
          <Button
            size="lg"
            variant="secondary"
            onClick={() => void handleSignIn()}
            loading={busy}
            className="min-w-64"
          >
            {!busy && <GoogleIcon />}
            Continue with Google
          </Button>
          {error != null && (
            <div className="w-full max-w-md space-y-2">
              <ErrorState error={error} />
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Use a different account
              </Button>
            </div>
          )}
        </div>

        <ul className="mt-20 grid gap-6 text-left sm:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="rounded-2xl bg-white/70 p-6 shadow-sm ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/70 dark:ring-slate-800"
            >
              <Icon className="size-6 text-brand-600 dark:text-brand-500" aria-hidden />
              <h2 className="mt-4 font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
