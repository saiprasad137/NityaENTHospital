import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import Admin from '@/pages/Admin';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const rawClerkKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim();
const hasValidClerkKey = Boolean(
  rawClerkKey &&
  !rawClerkKey.includes('...') &&
  (rawClerkKey.startsWith('pk_test_') || rawClerkKey.startsWith('pk_live_')),
);
const clerkPubKey = hasValidClerkKey
  ? publishableKeyFromHost(window.location.hostname, rawClerkKey)
  : undefined;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  variables: {
    colorPrimary: '#286d5c',
    colorForeground: '#23463f',
    colorMutedForeground: '#71837c',
    colorDanger: '#b94e43',
    colorBackground: '#fbf8f0',
    colorInput: '#fffdf8',
    colorInputForeground: '#23463f',
    colorNeutral: '#d9d2c4',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '14px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f0] rounded-3xl w-[440px] max-w-full overflow-hidden shadow-xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'brand text-[#23463f]',
    headerSubtitle: 'text-[#71837c]',
    formFieldLabel: 'text-[#23463f]',
    formFieldInput: 'bg-[#fffdf8] border-[#d9d2c4]',
    formButtonPrimary: 'bg-[#286d5c] hover:bg-[#20594c]',
    footerActionLink: 'text-[#286d5c]',
  },
};

function AuthCacheSync() {
  const { addListener } = useClerk();
  const cache = useQueryClient();
  const previousId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (previousId.current !== undefined && previousId.current !== id) cache.clear();
    previousId.current = id;
  }), [addListener, cache]);
  return null;
}

function AuthPages() {
  if (!clerkPubKey) {
    return <div className="grid min-h-[70dvh] place-items-center"><div className="max-w-md rounded-3xl bg-[#fbf8f0] p-8 text-center shadow-xl"><h1 className="display text-3xl text-[#23463f]">Administrator sign-in</h1><p className="mt-3 text-sm leading-6 text-[#71837c]">Clerk is not configured for this environment yet. The public hospital site remains available.</p><a href={basePath || '/'} className="mt-6 inline-block text-sm font-bold text-[#286d5c]">Return to the hospital site</a></div></div>;
  }
  return (
    <div className="min-h-[100dvh] bg-[#e9eee6] px-5 py-8">
      <div className="mx-auto mb-8 flex max-w-5xl items-center justify-between">
        <a href={basePath || '/'} className="brand text-lg font-extrabold tracking-tight text-[#23463f]">Nitya ENT <span className="font-medium text-[#78877e]">/ care with clarity</span></a>
        <a href={basePath || '/'} className="text-sm font-semibold text-[#286d5c]">Return to hospital site</a>
      </div>
      <Switch>
        <Route path="/sign-in/*?">
          <div className="mx-auto max-w-5xl rounded-[2rem] bg-[#f7f5ed] p-5 shadow-[0_24px_80px_rgba(24,60,50,.12)] md:grid md:grid-cols-[.85fr_1fr] md:items-center md:gap-8 md:p-12">
            <div className="hidden py-10 md:block"><div className="mb-5 text-xs font-bold uppercase tracking-[.22em] text-[#b57862]">Nitya ENT · administration</div><h1 className="display text-5xl leading-[1.05] text-[#23463f]">A calmer way to care for the details.</h1><p className="mt-5 max-w-sm leading-7 text-[#71837c]">Sign in to manage appointments, availability and hospital updates.</p></div>
            <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
          </div>
        </Route>
        <Route path="/sign-up/*?">
          <div className="mx-auto max-w-5xl rounded-[2rem] bg-[#f7f5ed] p-5 shadow-[0_24px_80px_rgba(24,60,50,.12)] md:grid md:grid-cols-[.85fr_1fr] md:items-center md:gap-8 md:p-12">
            <div className="hidden py-10 md:block"><div className="mb-5 text-xs font-bold uppercase tracking-[.22em] text-[#b57862]">Nitya ENT · administration</div><h1 className="display text-5xl leading-[1.05] text-[#23463f]">Keep trusted care in motion.</h1><p className="mt-5 max-w-sm leading-7 text-[#71837c]">Administrator access is managed through your hospital account.</p></div>
            <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
          </div>
        </Route>
      </Switch>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Switch>
    <Route path="/" component={Home} />
    <Route path="/sign-in/*?" component={AuthPages} />
    <Route path="/sign-up/*?" component={AuthPages} />
    <Route path="/admin" component={Admin} />
    <Route path="/admin/appointments" component={Admin} />
    <Route path="/admin/doctors" component={Admin} />
    <Route path="/admin/events" component={Admin} />
    <Route path="/admin/achievements" component={Admin} />
    <Route path="/admin/media" component={Admin} />
    <Route component={NotFound} />
  </Switch></ErrorBoundary>;
}

function ClerkRouter() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to manage Nitya ENT' } }, signUp: { start: { title: 'Create your account', subtitle: 'Administrator access is managed by your hospital' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}>
      <AuthCacheSync />
      <TooltipProvider><Router /><Toaster /></TooltipProvider>
    </QueryClientProvider>
  </ClerkProvider>;
}

function Routed({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  if (!clerkPubKey) {
    return <QueryClientProvider client={queryClient}><TooltipProvider><Routed><WouterRouter base={basePath}><Router /></WouterRouter></Routed><Toaster /></TooltipProvider></QueryClientProvider>;
  }
  return <WouterRouter base={basePath}><ClerkRouter /></WouterRouter>;
}

export default App;
