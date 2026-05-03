import { Link, useLocation } from "wouter";
import { ExternalLink } from "lucide-react";
import { Refrigerator, Settings, CalendarRange, ShoppingCart, LogOut } from "lucide-react";
import { motion } from "framer-motion";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useAuth } from "@/context/AuthContext";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NAV_ITEMS = [
  { href: "/", label: "Mon Frigo", icon: Refrigerator },
  { href: "/menu", label: "Menu", icon: CalendarRange },
  { href: "/shopping", label: "Liste & Épiceries", icon: ShoppingCart },
  { href: "/preferences", label: "Préférences", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const userLabel = user?.email ?? "";
  const initial = (userLabel[0] ?? "?").toUpperCase();

  return (
    <div className="min-h-screen flex w-full">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-64 fixed inset-y-0 left-0 bg-card border-r border-border/60 z-20 no-print">
        <div className="p-8 flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Refrigerator className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            MonFrigo
          </h1>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-2xl font-medium transition-all duration-300 relative group overflow-hidden",
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute inset-0 bg-primary/10 rounded-2xl z-0"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon
                  className={cn(
                    "w-5 h-5 z-10 transition-transform duration-300",
                    isActive ? "scale-105" : "group-hover:scale-105"
                  )}
                />
                <span className="z-10">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-4 pb-6 pt-3 border-t border-border/50 mt-2">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-primary/15 text-primary font-semibold flex items-center justify-center text-sm">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground truncate" title={userLabel}>
                {userLabel}
              </p>
            </div>
            <button
              onClick={() => logout()}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              title="Déconnexion"
              aria-label="Déconnexion"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1 px-2 mt-2">
            <Link
              href="/privacy"
              className="text-[11px] text-muted-foreground/60 hover:text-primary transition-colors flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> Confidentialité
            </Link>
            <Link
              href="/terms"
              className="text-[11px] text-muted-foreground/60 hover:text-primary transition-colors flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> Conditions d'utilisation
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 min-h-screen pb-24 lg:pb-0 print-container">
        <div className="max-w-6xl mx-auto p-6 sm:p-8 lg:p-10">
          <motion.div
            key={location}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            {children}
          </motion.div>
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 h-20 bg-card/90 backdrop-blur-xl border-t border-border/40 flex items-center justify-around px-2 pb-2 z-50 no-print">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full space-y-1 relative",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "p-1.5 px-4 rounded-xl transition-all duration-300",
                  isActive ? "bg-primary/10" : "bg-transparent"
                )}
              >
                <item.icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
