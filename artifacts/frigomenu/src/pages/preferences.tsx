import { useState, useEffect } from "react";
import { useGetPreferences, useSavePreferences } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, Label } from "@/components/ui-elements";
import { ChefHat, Clock, Users, Wallet, Leaf, Flame, Check, Sparkles, ExternalLink, UtensilsCrossed } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/components/ui-elements";
import { useUser, useAuth } from "@clerk/react";
import { usePaywall } from "@/hooks/usePaywall";

const ALLERGIES = ["Gluten", "Arachides", "Lactose", "Œufs", "Fruits de mer", "Noix", "Soja", "Sésame"];
const DIETS = [
  "Végétarien", "Vegan", "Sans gluten", "Méditerranéen", "Faible en gras",
  "Riche en protéines", "Halal", "Casher", "Faible en sucres",
];
const CUISINES = ["Française", "Italienne", "Mexicaine", "Asiatique", "Québécoise", "Méditerranéenne"];

const MEAL_TYPES: Array<{ key: "breakfast" | "lunch" | "dinner"; label: string }> = [
  { key: "breakfast", label: "Déjeuner" },
  { key: "lunch", label: "Dîner" },
  { key: "dinner", label: "Souper" },
];

function MultiSelectChip({ 
  options, 
  selected, 
  onChange 
}: { 
  options: string[], 
  selected: string[], 
  onChange: (val: string[]) => void 
}) {
  const toggle = (opt: string) => {
    if (selected.includes(opt)) {
      onChange(selected.filter(x => x !== opt));
    } else {
      onChange([...selected, opt]);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      {options.map(opt => {
        const isSelected = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={cn(
              "px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200",
              isSelected 
                ? "bg-accent/20 text-accent-foreground border-transparent" 
                : "bg-card border border-border/60 text-muted-foreground hover:bg-muted/50"
            )}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function SubscriptionCard() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const paywall = usePaywall();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const email = user?.primaryEmailAddress?.emailAddress;
      if (!email) throw new Error("Email du compte introuvable");
      const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
      const token = await getToken();
      const res = await fetch(`${apiBase}/api/stripe/create-portal-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          email,
          userId: user?.id,
          returnUrl: window.location.href,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `Erreur ${res.status}`);
      if (!j.url) throw new Error("URL du portail manquante");
      window.location.href = j.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setLoading(false);
    }
  };

  if (!paywall.isSubscribed) return null;

  return (
    <Card className="p-8 bg-gradient-to-br from-primary/8 to-secondary/8 border-primary/20">
      <div className="flex items-start gap-4">
        <div className="p-3 bg-primary/15 rounded-2xl shrink-0">
          <Sparkles className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xl font-display font-bold">Abonnement Premium actif</h3>
          <p className="text-muted-foreground text-sm mt-1.5">
            Gérez votre méthode de paiement, consultez vos factures ou annulez votre abonnement à tout moment via le portail sécurisé Stripe.
          </p>
          {error && (
            <div className="mt-3 bg-destructive/10 text-destructive text-sm rounded-xl p-3">
              {error}
            </div>
          )}
          <div className="mt-5">
            <Button onClick={openPortal} disabled={loading} variant="outline">
              <ExternalLink className="w-4 h-4 mr-2" />
              {loading ? "Ouverture..." : "Gérer mon abonnement"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function PreferencesPage() {
  const { data: pref, isLoading } = useGetPreferences();
  const queryClient = useQueryClient();
  const saveMutation = useSavePreferences({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/preferences"] })
    }
  });

  const [formData, setFormData] = useState({
    cookingTimePerDay: 45,
    weeklyBudget: 150,
    numberOfPeople: 2,
    allergies: [] as string[],
    dietaryPreferences: [] as string[],
    cuisinePreferences: [] as string[],
    mealTypes: ["breakfast", "lunch", "dinner"] as string[],
  });

  useEffect(() => {
    if (pref) {
      setFormData({
        cookingTimePerDay: pref.cookingTimePerDay,
        weeklyBudget: pref.weeklyBudget,
        numberOfPeople: pref.numberOfPeople,
        allergies: pref.allergies || [],
        dietaryPreferences: pref.dietaryPreferences || [],
        cuisinePreferences: pref.cuisinePreferences || [],
        mealTypes: pref.mealTypes && pref.mealTypes.length > 0
          ? pref.mealTypes
          : ["breakfast", "lunch", "dinner"],
      });
    }
  }, [pref]);

  const toggleMealType = (key: string) => {
    setFormData(fd => {
      const next = fd.mealTypes.includes(key)
        ? fd.mealTypes.filter(k => k !== key)
        : [...fd.mealTypes, key];
      // Au moins un repas doit rester sélectionné.
      return { ...fd, mealTypes: next.length > 0 ? next : fd.mealTypes };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ data: formData });
  };

  if (isLoading) return <div className="p-10 text-center animate-pulse text-lg text-muted-foreground">Chargement des préférences...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-10 pb-12 pt-4">
      <div>
        <h1 className="text-4xl font-display font-bold text-foreground">
          Vos Préférences
        </h1>
        <p className="text-lg text-muted-foreground mt-3">
          L'IA utilisera ces informations pour générer un menu parfaitement adapté à votre foyer.
        </p>
      </div>

      <SubscriptionCard />

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-8 flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-4 bg-primary/10 rounded-2xl">
              <Clock className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-medium text-muted-foreground">Temps (min/jour)</h3>
            <Input 
              type="number" 
              min="15" max="180" step="5"
              className="text-4xl font-display font-bold text-center h-20 bg-transparent border-none focus-visible:ring-0 shadow-none p-0"
              value={formData.cookingTimePerDay}
              onChange={e => setFormData({...formData, cookingTimePerDay: parseInt(e.target.value) || 0})}
            />
          </Card>

          <Card className="p-8 flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-4 bg-emerald-500/10 rounded-2xl">
              <Wallet className="w-8 h-8 text-emerald-600" />
            </div>
            <h3 className="font-medium text-muted-foreground">Budget Hebdo</h3>
            <div className="relative flex items-center justify-center w-full">
              <Input 
                type="number" 
                min="0" step="10"
                className="text-4xl font-display font-bold text-center h-20 bg-transparent border-none focus-visible:ring-0 shadow-none p-0 w-32"
                value={formData.weeklyBudget}
                onChange={e => setFormData({...formData, weeklyBudget: parseInt(e.target.value) || 0})}
              />
              <span className="text-2xl font-bold text-muted-foreground absolute right-4">$</span>
            </div>
          </Card>

          <Card className="p-8 flex flex-col items-center justify-center text-center space-y-4">
            <div className="p-4 bg-secondary/10 rounded-2xl">
              <Users className="w-8 h-8 text-secondary" />
            </div>
            <h3 className="font-medium text-muted-foreground">Personnes</h3>
            <Input 
              type="number" 
              min="1" max="10"
              className="text-4xl font-display font-bold text-center h-20 bg-transparent border-none focus-visible:ring-0 shadow-none p-0"
              value={formData.numberOfPeople}
              onChange={e => setFormData({...formData, numberOfPeople: parseInt(e.target.value) || 1})}
            />
          </Card>
        </div>

        <Card className="p-10 space-y-10">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-destructive/10 rounded-xl">
                <Flame className="w-5 h-5 text-destructive" />
              </div>
              <h3 className="text-xl font-display font-bold">Allergies & Intolérances</h3>
            </div>
            <MultiSelectChip 
              options={ALLERGIES} 
              selected={formData.allergies} 
              onChange={(v) => setFormData({...formData, allergies: v})} 
            />
          </div>

          <div className="h-px bg-border/40 w-full" />

          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-primary/10 rounded-xl">
                <Leaf className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-xl font-display font-bold">Régimes alimentaires</h3>
            </div>
            <MultiSelectChip 
              options={DIETS} 
              selected={formData.dietaryPreferences} 
              onChange={(v) => setFormData({...formData, dietaryPreferences: v})} 
            />
          </div>

          <div className="h-px bg-border/40 w-full" />

          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-amber-500/10 rounded-xl">
                <ChefHat className="w-5 h-5 text-amber-500" />
              </div>
              <h3 className="text-xl font-display font-bold">Styles de cuisine préférés</h3>
            </div>
            <MultiSelectChip 
              options={CUISINES} 
              selected={formData.cuisinePreferences} 
              onChange={(v) => setFormData({...formData, cuisinePreferences: v})} 
            />
          </div>

          <div className="h-px bg-border/40 w-full" />

          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-blue-500/10 rounded-xl">
                <UtensilsCrossed className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-xl font-display font-bold">Repas à générer</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Cochez les repas que l'IA doit planifier. Décochez ceux que vous gérez par vous-même.
            </p>
            <div className="flex flex-wrap gap-3">
              {MEAL_TYPES.map(({ key, label }) => {
                const isSelected = formData.mealTypes.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleMealType(key)}
                    className={cn(
                      "flex items-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200",
                      isSelected
                        ? "bg-primary/15 text-foreground border-transparent"
                        : "bg-card border border-border/60 text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span
                      className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center",
                        isSelected
                          ? "bg-primary border-primary"
                          : "border-border bg-card"
                      )}
                    >
                      {isSelected && <Check className="w-3 h-3 text-primary-foreground" strokeWidth={3} />}
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        <div className="flex justify-end pt-6 sticky bottom-24 lg:bottom-6 z-10 no-print">
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button size="lg" type="submit" disabled={saveMutation.isPending} className="shadow-lg">
              {saveMutation.isPending ? "Enregistrement..." : (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  Sauvegarder mes préférences
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </form>
    </div>
  );
}
