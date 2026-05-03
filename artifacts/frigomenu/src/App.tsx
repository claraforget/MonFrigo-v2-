import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/context/AuthContext";

import FridgePage from "@/pages/fridge";
import PreferencesPage from "@/pages/preferences";
import MenuPage from "@/pages/menu";
import ShoppingPage from "@/pages/shopping";
import NotFound from "@/pages/not-found";
import { CookieBanner } from "@/components/CookieBanner";
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
import SignInPage from "@/pages/sign-in";
import SignUpPage from "@/pages/sign-up";

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl);
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function ProtectedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Redirect to="/sign-in" />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={FridgePage} />
        <Route path="/preferences" component={PreferencesPage} />
        <Route path="/menu" component={MenuPage} />
        <Route path="/shopping" component={ShoppingPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AppRoutes() {
  const [location] = useLocation();
  // Clear query cache when navigating to sign-in (logout)
  if (location === "/sign-in") {
    queryClient.clear();
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Switch>
          <Route path="/sign-in" component={SignInPage} />
          <Route path="/sign-up" component={SignUpPage} />
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
          <Route component={ProtectedApp} />
        </Switch>
        <Toaster />
        <CookieBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </WouterRouter>
  );
}

export default App;
