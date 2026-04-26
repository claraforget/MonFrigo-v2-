import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, Check, ShieldCheck, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui-elements";
import { useUser, useAuth } from "@clerk/react";

export function PaywallModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useUser();
  const { getToken } = useAuth();

  const handleSubscribe = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentUrl = window.location.origin + window.location.pathname;
      const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
      const token = await getToken();
      const res = await fetch(`${apiBase}/api/stripe/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          successUrl: `${currentUrl}?paid=true`,
          cancelUrl: `${currentUrl}?paid=cancel`,
          email: user?.primaryEmailAddress?.emailAddress,
          userId: user?.id,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Erreur ${res.status}`);
      }
      const { url } = await res.json();
      if (!url) throw new Error("URL Stripe manquante");
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de paiement");
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card rounded-3xl shadow-2xl max-w-md w-full overflow-hidden relative"
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted/70 transition-colors z-10"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>

            {/* En-tête dégradé */}
            <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-secondary/15 px-8 pt-10 pb-6 text-center">
              <div className="inline-flex p-4 bg-white rounded-2xl shadow-sm mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-2xl font-display font-bold text-foreground">
                Continuez à cuisiner intelligemment
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Vous avez utilisé vos 2 générations gratuites
              </p>
            </div>

            {/* Corps */}
            <div className="px-8 py-6">
              {/* Garantie économies */}
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-6 flex gap-3">
                <div className="shrink-0 p-2 bg-emerald-100 rounded-xl h-fit">
                  <TrendingDown className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-900 text-sm leading-snug">
                    Garantie d'économies
                  </p>
                  <p className="text-emerald-800/80 text-xs mt-1 leading-relaxed">
                    Nous garantissons que les économies réalisées à l'épicerie
                    grâce à vos menus optimisés rembourseront largement ce
                    coût&nbsp;— souvent dès la première semaine.
                  </p>
                </div>
              </div>

              {/* Avantages */}
              <ul className="space-y-3 mb-6">
                {[
                  "Générations illimitées de menus hebdomadaires",
                  "Listes d'épicerie optimisées",
                  "Comparateur d'épiceries près de chez vous",
                  "Export PDF haute qualité",
                ].map((benefit) => (
                  <li key={benefit} className="flex items-start gap-3 text-sm">
                    <div className="shrink-0 mt-0.5 p-0.5 bg-primary/10 rounded-full">
                      <Check className="w-3.5 h-3.5 text-primary" strokeWidth={3} />
                    </div>
                    <span className="text-foreground/90">{benefit}</span>
                  </li>
                ))}
              </ul>

              {/* Prix */}
              <div className="text-center mb-5">
                <div className="flex items-baseline justify-center gap-1.5">
                  <span className="text-5xl font-display font-bold text-foreground">10</span>
                  <span className="text-2xl font-semibold text-foreground">$</span>
                  <span className="text-sm text-muted-foreground ml-1">CAD / mois</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Annulable à tout moment
                </p>
              </div>

              {error && (
                <div className="bg-destructive/10 text-destructive text-sm rounded-xl p-3 mb-4 text-center">
                  {error}
                </div>
              )}

              <Button
                onClick={handleSubscribe}
                disabled={loading}
                size="lg"
                className="w-full"
              >
                {loading ? "Redirection..." : "S'abonner pour 10 $ / mois"}
              </Button>

              <p className="text-[11px] text-muted-foreground text-center mt-4 flex items-center justify-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Paiement sécurisé par Stripe
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
