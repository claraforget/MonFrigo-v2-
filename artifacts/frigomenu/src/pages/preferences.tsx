import { useState, useEffect } from "react";
import { useGetPreferences, useSavePreferences } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, Button, Input, Label } from "@/components/ui-elements";
import { ChefHat, Clock, Users, Wallet, Leaf, Flame, Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/components/ui-elements";

const ALLERGIES = ["Gluten", "Arachides", "Lactose", "Œufs", "Fruits de mer", "Noix", "Soja", "Sésame"];
const DIETS = ["Végétarien", "Vegan", "Sans gluten", "Méditerranéen", "Faible en gras", "Riche en protéines"];
const CUISINES = ["Française", "Italienne", "Mexicaine", "Asiatique", "Québécoise", "Méditerranéenne"];

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
      });
    }
  }, [pref]);

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
