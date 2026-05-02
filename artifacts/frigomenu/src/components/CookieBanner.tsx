import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie, X, Shield } from "lucide-react";
import { Link } from "wouter";

const CONSENT_KEY = "monfrigo_cookie_consent";

type ConsentValue = "accepted" | "declined";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  const save = (value: ConsentValue) => {
    localStorage.setItem(CONSENT_KEY, value);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 120, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", damping: 24, stiffness: 200 }}
          className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6"
          role="dialog"
          aria-label="Politique de confidentialité et cookies"
        >
          <div className="mx-auto max-w-4xl bg-white dark:bg-neutral-900 border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mt-0.5">
                  <Cookie className="w-5 h-5 text-primary" />
                </div>

                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-foreground text-sm sm:text-base mb-1">
                    Votre vie privée nous importe
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    MonFrigo utilise des témoins (cookies) pour le bon fonctionnement de l'authentification et la mémorisation de vos préférences.
                    Conformément à la <strong>Loi 25 du Québec</strong> et au <strong>PIPEDA</strong>, nous vous informons de leur usage.{" "}
                    <button
                      onClick={() => setShowDetails(!showDetails)}
                      className="text-primary underline underline-offset-2 hover:no-underline focus:outline-none"
                    >
                      {showDetails ? "Masquer les détails" : "En savoir plus"}
                    </button>
                  </p>

                  <AnimatePresence>
                    {showDetails && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 grid sm:grid-cols-3 gap-2 text-xs text-muted-foreground">
                          {[
                            { name: "Authentification (Clerk)", desc: "Session utilisateur sécurisée. Requis pour accéder à l'app.", required: true },
                            { name: "Préférences locales", desc: "Mémorise vos réglages d'interface et votre consentement.", required: true },
                            { name: "Paiement (Stripe)", desc: "Traitement sécurisé des abonnements lors de l'achat.", required: false },
                          ].map((c) => (
                            <div key={c.name} className="flex items-start gap-2 bg-muted/40 rounded-lg p-3">
                              <Shield className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary/70" />
                              <div>
                                <span className="font-medium text-foreground">{c.name}</span>
                                {c.required && (
                                  <span className="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 ml-1 font-medium">Requis</span>
                                )}
                                <p className="mt-0.5">{c.desc}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 text-[11px] text-muted-foreground/70">
                          Vos données ne sont jamais vendues à des tiers.{" "}
                          <Link href="/privacy" className="text-primary underline">Politique de confidentialité</Link>
                          {" · "}
                          <Link href="/terms" className="text-primary underline">Conditions d'utilisation</Link>
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button
                  onClick={() => save("declined")}
                  className="shrink-0 p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Fermer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 justify-end items-center">
                <span className="text-[11px] text-muted-foreground/60 mr-auto hidden sm:block">
                  <Link href="/privacy" className="hover:text-primary transition-colors underline underline-offset-2">Confidentialité</Link>
                  {" · "}
                  <Link href="/terms" className="hover:text-primary transition-colors underline underline-offset-2">Conditions</Link>
                </span>
                <button
                  onClick={() => save("declined")}
                  className="px-4 py-2 text-sm rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors"
                >
                  Continuer sans accepter
                </button>
                <button
                  onClick={() => save("accepted")}
                  className="px-5 py-2 text-sm rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
                >
                  Accepter tout
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
