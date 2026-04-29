import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";

import FridgePage from "@/pages/fridge";
import PreferencesPage from "@/pages/preferences";
import MenuPage from "@/pages/menu";
import ShoppingPage from "@/pages/shopping";
import NotFound from "@/pages/not-found";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

// URL absolue du backend (ex: https://monfrigo-api.onrender.com).
// Vide en dev local sur Replit (l'API est sur le même domaine via le proxy).
const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#7FB069",
    colorForeground: "#1f2937",
    colorMutedForeground: "#6b7280",
    colorDanger: "#dc2626",
    colorBackground: "#ffffff",
    colorInput: "#f9fafb",
    colorInputForeground: "#1f2937",
    colorNeutral: "#e5e7eb",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "bg-white rounded-3xl shadow-xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-2xl font-bold text-gray-900",
    headerSubtitle: "text-gray-500",
    socialButtonsBlockButton: "border border-gray-200 hover:bg-gray-50 transition-colors",
    socialButtonsBlockButtonText: "text-gray-700 font-medium",
    formButtonPrimary: "bg-[#7FB069] hover:bg-[#6fa05a] text-white font-semibold",
    formFieldLabel: "text-gray-700 font-medium",
    formFieldInput: "border border-gray-200 bg-gray-50",
    footerActionLink: "text-[#7FB069] hover:text-[#6fa05a] font-semibold",
    footerActionText: "text-gray-500",
    dividerText: "text-gray-400",
    dividerLine: "bg-gray-200",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-[#7FB069]/10 via-white to-[#FFB997]/10 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-[#7FB069]/10 via-white to-[#FFB997]/10 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// Attache le jeton de session Clerk à chaque appel API. Sans ça, le backend
// (qui est sur un autre domaine en production) reçoit toutes les requêtes
// comme anonymes et répond 401 « Non authentifié ».
function ClerkApiAuthBridge() {
  const { getToken, isLoaded } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken, isLoaded]);
  return null;
}

function ProtectedApp() {
  return (
    <>
      <Show when="signed-in">
        <Layout>
          <Switch>
            <Route path="/" component={FridgePage} />
            <Route path="/preferences" component={PreferencesPage} />
            <Route path="/menu" component={MenuPage} />
            <Route path="/shopping" component={ShoppingPage} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: { title: "Bon retour !", subtitle: "Connectez-vous à votre frigo" },
        },
        signUp: {
          start: { title: "Créez votre compte", subtitle: "Commencez à planifier vos repas" },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkApiAuthBridge />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ProtectedApp} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
