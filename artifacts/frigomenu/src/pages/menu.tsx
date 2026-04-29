import { useGetCurrentMenu, useDeleteCurrentMenu } from "@workspace/api-client-react";
import { Card, Button, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Printer, Clock, DollarSign, ChevronDown, CheckCircle2, Trash2 } from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";
import { jsPDF } from "jspdf";
import { motion, AnimatePresence } from "framer-motion";
import type { Meal } from "@workspace/api-client-react/src/generated/api.schemas";
import { usePaywall } from "@/hooks/usePaywall";
import { PaywallModal } from "@/components/PaywallModal";
import { useAuth, useUser } from "@clerk/react";

function MealCard({ title, meal, forceOpen = false }: { title: string, meal: Meal | null | undefined, forceOpen?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || forceOpen;

  if (!meal) return null;

  return (
    <div className="border border-border/40 rounded-2xl overflow-hidden bg-card hover:border-border/80 transition-all print-break-inside-avoid">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <div className="flex items-center gap-4">
          <span className="font-bold text-muted-foreground w-20 uppercase tracking-widest text-[10px] sm:text-xs">{title}</span>
          <span className="font-semibold text-foreground text-sm sm:text-base">{meal.name}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <Badge variant="outline" className="hidden sm:flex whitespace-nowrap bg-background/50 border-none">
            <Clock className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> {meal.cookingTime} min
          </Badge>
          {meal.difficultyLevel && (
            <span className={`hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wide border ${
              meal.difficultyLevel === "Facile"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                : meal.difficultyLevel === "Moyen"
                ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800"
                : "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-800"
            }`}>
              {meal.difficultyLevel}
            </span>
          )}
          <div className={`p-1.5 rounded-full transition-colors no-print ${isOpen ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
            <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} />
          </div>
        </div>
      </button>
      
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-5 pt-0 border-t border-border/20 bg-background/30">
              <p className="text-sm text-muted-foreground mb-6 italic leading-relaxed">{meal.description}</p>
              
              <div className="grid sm:grid-cols-2 gap-8">
                <div>
                  <h4 className="font-bold text-[11px] uppercase tracking-wider mb-4 text-foreground/70 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Ingrédients
                  </h4>
                  <ul className="space-y-2">
                    {meal.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm flex items-start group">
                        <CheckCircle2 className="w-4 h-4 mr-2.5 text-primary/40 mt-0.5 group-hover:text-primary transition-colors" /> 
                        <span className="text-foreground/80">{ing}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-bold text-[11px] uppercase tracking-wider mb-4 text-foreground/70 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary" /> Instructions
                  </h4>
                  <ol className="space-y-3">
                    {meal.instructions.map((inst, i) => (
                      <li key={i} className="text-sm text-foreground/80 leading-relaxed flex items-start">
                        <span className="font-display font-bold text-muted-foreground mr-3 mt-0.5">{i + 1}.</span>
                        {inst}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function MenuPage() {
  const { data, isLoading } = useGetCurrentMenu();
  const queryClient = useQueryClient();
  const paywall = usePaywall();
  const { getToken } = useAuth();
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prevMenuIdRef = useRef<number | null | undefined>(undefined);
  const pendingCountRef = useRef(false);

  // Étape 1 — Dès le montage : détecter ?paid=true, nettoyer l'URL et mémoriser en session
  // (Clerk n'est pas encore chargé ici — ne pas appeler subscribe() maintenant)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") === "true") {
      sessionStorage.setItem("stripe_paid_pending", "true");
      params.delete("paid");
      const newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // Étape 2 — Dès que Clerk est chargé et l'utilisateur connu : activer l'abonnement
  useEffect(() => {
    if (!clerkLoaded || !isSignedIn) return;
    if (sessionStorage.getItem("stripe_paid_pending") === "true") {
      sessionStorage.removeItem("stripe_paid_pending");
      paywall.subscribe();
    }
  }, [clerkLoaded, isSignedIn]);

  // Décrémenter le compteur quand un NOUVEAU menu apparaît en DB (fiable même si SSE est coupé)
  useEffect(() => {
    const currentId = data?.menu?.id ?? null;
    if (prevMenuIdRef.current === undefined) {
      // Premier chargement — initialiser sans incrémenter
      prevMenuIdRef.current = currentId;
      return;
    }
    if (pendingCountRef.current && currentId !== null && currentId !== prevMenuIdRef.current) {
      paywall.incrementCount();
      pendingCountRef.current = false;
    }
    prevMenuIdRef.current = currentId;
  }, [data?.menu?.id]);

  const generateMenuSSE = useCallback(async () => {
    setIsGenerating(true);
    setGenerateError(null);
    pendingCountRef.current = true;
    abortRef.current = new AbortController();

    // Distinguer les erreurs pré-stream (avant d'avoir reçu quoi que ce soit)
    // des erreurs mid-stream (connexion coupée par Vercel à 10s — le menu peut quand même être sauvé)
    let preStreamError = false;
    let streamingStarted = false;
    let sseError = false;

    try {
      const token = await getToken();
      const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
      const res = await fetch(`${apiBase}/api/menu/generate`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        preStreamError = true;
        const status = res.status;
        if (status === 401 || status === 403) {
          setGenerateError("Session expirée — reconnectez-vous.");
        } else if (status === 429) {
          setGenerateError("Limite de quota atteinte — réessayez dans quelques instants.");
        } else {
          setGenerateError(`Erreur serveur (${status}) — réessayez.`);
        }
        return;
      }

      streamingStarted = true;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const json = line.slice(5).trim();
          if (!json) continue;
          try {
            const event = JSON.parse(json);
            if (event.status === "error") {
              sseError = true;
              setGenerateError(event.message ?? "Erreur de génération");
            }
          } catch {
            // chunk JSON invalide — ignorer
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        pendingCountRef.current = false;
        return;
      }
      if (!streamingStarted) {
        // Jamais commencé — erreur réseau vraie
        preStreamError = true;
        setGenerateError("Impossible de joindre le serveur — vérifiez votre connexion.");
      }
      // Si le stream avait commencé : connexion coupée (timeout Vercel) — le menu est peut-être sauvé
      // Ne pas afficher d'erreur, laisser le finally rafraîchir la query
    } finally {
      setIsGenerating(false);
      if (preStreamError || sseError) {
        pendingCountRef.current = false;
      } else if (streamingStarted) {
        // Rafraîchir immédiatement + une 2e fois après 4s (si la DB s'est mise à jour juste après le timeout)
        queryClient.invalidateQueries({ queryKey: ["/api/menu/current"] });
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/menu/current"] }), 4000);
      }
    }
  }, [getToken, queryClient]);

  const handleGenerateClick = () => {
    paywall.checkAndGenerate(() => generateMenuSSE());
  };

  const deleteMutation = useDeleteCurrentMenu({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/menu/current"] })
    }
  });

  const handlePrint = useCallback(() => {
    if (!data?.menu) return;
    const menu = data.menu;
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = 20;

    const checkPage = (needed: number) => {
      if (y + needed > 275) { doc.addPage(); y = 15; }
    };

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(74, 139, 84);
    doc.text("MonFrigo — Menu de la semaine", margin, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date(menu.generatedAt).toLocaleDateString("fr-CA", { year: "numeric", month: "long", day: "numeric" });
    doc.text(`Généré le ${dateStr}  •  Coût estimé : ${menu.estimatedCost} $`, margin, y);
    y += 10;

    // Divider
    doc.setDrawColor(220, 220, 210);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    const mealTitles: Record<string, string> = { breakfast: "Déjeuner", lunch: "Dîner", dinner: "Souper" };

    for (const day of menu.days) {
      checkPage(18);
      // Day header
      doc.setFillColor(237, 247, 239);
      doc.roundedRect(margin, y, contentW, 10, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(74, 139, 84);
      doc.text(day.dayName, margin + 4, y + 7);
      y += 14;

      for (const [key, label] of Object.entries(mealTitles)) {
        const meal = day[key as keyof typeof day] as Meal | null | undefined;
        if (!meal) continue;
        checkPage(30);

        // Meal name row
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(60, 60, 60);
        doc.text(`${label} — ${meal.name}`, margin + 2, y);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`${meal.cookingTime} min`, pageW - margin - 2, y, { align: "right" });
        y += 5;

        // Description
        if (meal.description) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(8);
          doc.setTextColor(120, 120, 120);
          const descLines = doc.splitTextToSize(meal.description, contentW - 4);
          checkPage(descLines.length * 4 + 2);
          doc.text(descLines, margin + 2, y);
          y += descLines.length * 4 + 2;
        }

        // Ingredients
        checkPage(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Ingrédients :", margin + 2, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        for (const ing of meal.ingredients) {
          checkPage(5);
          doc.text(`• ${ing}`, margin + 5, y);
          y += 4;
        }

        // Instructions
        checkPage(12);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Instructions :", margin + 2, y);
        y += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80, 80, 80);
        meal.instructions.forEach((inst, i) => {
          const lines = doc.splitTextToSize(`${i + 1}. ${inst}`, contentW - 7);
          checkPage(lines.length * 4 + 2);
          doc.text(lines, margin + 5, y);
          y += lines.length * 4 + 2;
        });

        y += 3;
        doc.setDrawColor(235, 235, 228);
        doc.line(margin + 4, y, pageW - margin - 4, y);
        y += 5;
      }
      y += 4;
    }

    doc.save("monfrigo-semaine.pdf");
  }, [data]);

  if (isLoading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      <div className="relative">
        <div className="w-20 h-20 border-4 border-primary/20 rounded-full"></div>
        <div className="w-20 h-20 border-4 border-primary border-t-transparent rounded-full animate-spin absolute inset-0"></div>
      </div>
      <p className="text-muted-foreground text-lg animate-pulse font-medium">Chargement de votre menu...</p>
    </div>
  );

  const hasMenu = data?.found && data.menu;

  return (
    <div className="space-y-10 pb-12 pt-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6 no-print">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">
            Menu de la semaine
          </h1>
          {hasMenu && (
            <p className="text-lg text-muted-foreground mt-3 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-500" /> Coût estimé: <strong className="text-foreground">{data.menu.estimatedCost} $</strong>
            </p>
          )}
        </div>
        
        <div className="flex flex-wrap gap-3">
          {hasMenu && (
            <>
              <Button variant="outline" onClick={handlePrint} className="bg-card">
                <Printer className="w-5 h-5 mr-2" />
                Télécharger PDF
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (confirm("Supprimer le menu en cours ?")) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="bg-card text-destructive hover:bg-destructive/10 hover:border-destructive/40 border-destructive/20"
              >
                <Trash2 className="w-5 h-5 mr-2" />
                {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
              </Button>
            </>
          )}
          <Button 
            onClick={handleGenerateClick} 
            disabled={isGenerating}
            size="lg"
            className="w-full sm:w-auto"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            {isGenerating ? "Génération en cours..." : "Générer un menu"}
          </Button>
        </div>
      </div>

      {!paywall.isSubscribed && (
        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground -mt-6 no-print">
          <span>
            {paywall.remainingFree > 0
              ? `${paywall.remainingFree} génération${paywall.remainingFree > 1 ? "s" : ""} gratuite${paywall.remainingFree > 1 ? "s" : ""} restante${paywall.remainingFree > 1 ? "s" : ""}`
              : "Vous avez utilisé vos générations gratuites"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <button
            onClick={() => paywall.setShowPaywall(true)}
            className="text-primary font-semibold hover:underline"
          >
            Passer à Premium →
          </button>
        </div>
      )}
      {paywall.isSubscribed && (
        <div className="text-xs text-emerald-600 font-semibold text-right -mt-6 no-print flex items-center justify-end gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Accès Premium activé
        </div>
      )}

      <PaywallModal
        open={paywall.showPaywall}
        onClose={() => paywall.setShowPaywall(false)}
      />


      {/* Print header visible only in PDF */}
      <div className="hidden print:block mb-8 text-center border-b pb-4">
        <h1 className="text-3xl font-bold">MonFrigo - Votre semaine</h1>
        {hasMenu && <p className="text-gray-500 mt-2">Généré le {new Date(data.menu.generatedAt).toLocaleDateString('fr-CA')}</p>}
      </div>

      {isGenerating && (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-primary/5 rounded-[2rem] border border-primary/10">
          <div className="p-4 bg-primary/10 rounded-2xl mb-6">
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
          </div>
          <h3 className="text-2xl font-bold text-foreground mb-3">Création de la magie culinaire...</h3>
          <p className="text-muted-foreground max-w-md text-lg">L'IA analyse votre frigo et vos préférences pour composer le menu parfait. Cela prend généralement 10 à 20 secondes.</p>
        </div>
      )}

      {!isGenerating && generateError && (
        <div className="py-8 flex flex-col items-center justify-center text-center bg-destructive/5 rounded-2xl border border-destructive/20">
          <p className="text-destructive font-medium">{generateError}</p>
          <button onClick={handleGenerateClick} className="mt-3 text-sm text-primary font-semibold hover:underline">
            Réessayer
          </button>
        </div>
      )}

      {!isGenerating && !generateError && !hasMenu && (
        <div className="py-24 text-center flex flex-col items-center justify-center opacity-80">
          <img 
            src={`${import.meta.env.BASE_URL}images/empty-menu.png`} 
            alt="Menu vide" 
            className="w-48 h-48 object-contain mb-8 drop-shadow-xl"
          />
          <h3 className="text-2xl font-bold text-foreground">Aucun menu généré</h3>
          <p className="text-muted-foreground mt-3 max-w-md text-lg">
            Cliquez sur le bouton ci-dessus pour laisser l'IA créer un menu hebdomadaire adapté à votre frigo et vos goûts.
          </p>
        </div>
      )}

      {!isGenerating && hasMenu && (
        <div className="space-y-8">
          {data.menu.days.map((day, idx) => (
            <Card key={idx} className="p-0 overflow-hidden print-break-inside-avoid shadow-sm hover:shadow-md transition-shadow">
              <div className="bg-primary/5 px-8 py-5 border-b border-primary/10 flex items-center justify-between">
                <h2 className="text-2xl font-display font-bold text-primary">{day.dayName}</h2>
              </div>
              <div className="p-5 sm:p-8 space-y-4 bg-card">
                <MealCard title="Déjeuner" meal={day.breakfast} />
                <MealCard title="Dîner" meal={day.lunch} />
                <MealCard title="Souper" meal={day.dinner} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
