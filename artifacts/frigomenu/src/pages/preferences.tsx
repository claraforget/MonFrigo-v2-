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
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const isSelected = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border",
              isSelected 
                ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20 scale-105" 
                : "bg-background border-border text-muted-foreground hover:border-primary/50 hover:bg-primary/5"
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

  if (isLoading) return <div className="p-8 text-center animate-pulse">Chargement des préférences...</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-4xl font-display font-bold text-foreground flex items-center gap-3">
          <ChefHat className="w-10 h-10 text-secondary" />
          Vos Préférences
        </h1>
        <p className="text-lg text-muted-foreground mt-2">
          L'IA utilisera ces informations pour générer un menu parfaitement adapté à votre foyer.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4 text-primary">
              <Clock className="w-6 h-6" />
              <h3 className="font-semibold text-lg text-foreground">Temps (min/jour)</h3>
            </div>
            <div className="flex items-end gap-4">
              <Input 
                type="number" 
                min="15" max="180" step="5"
                className="text-2xl font-display font-bold py-4"
                value={formData.cookingTimePerDay}
                onChange={e => setFormData({...formData, cookingTimePerDay: parseInt(e.target.value) || 0})}
              />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4 text-emerald-500">
              <Wallet className="w-6 h-6" />
              <h3 className="font-semibold text-lg text-foreground">Budget Hebdo</h3>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-muted-foreground">$</span>
              <Input 
                type="number" 
                min="0" step="10"
                className="text-2xl font-display font-bold py-4 pl-10"
                value={formData.weeklyBudget}
                onChange={e => setFormData({...formData, weeklyBudget: parseInt(e.target.value) || 0})}
              />
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4 text-secondary">
              <Users className="w-6 h-6" />
              <h3 className="font-semibold text-lg text-foreground">Personnes</h3>
            </div>
            <Input 
              type="number" 
              min="1" max="10"
              className="text-2xl font-display font-bold py-4"
              value={formData.numberOfPeople}
              onChange={e => setFormData({...formData, numberOfPeople: parseInt(e.target.value) || 1})}
            />
          </Card>
        </div>

        <Card className="p-8 space-y-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Flame className="w-5 h-5 text-destructive" />
              <h3 className="text-xl font-bold">Allergies & Intolérances</h3>
            </div>
            <MultiSelectChip 
              options={ALLERGIES} 
              selected={formData.allergies} 
              onChange={(v) => setFormData({...formData, allergies: v})} 
            />
          </div>

          <hr className="border-border/50" />

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Leaf className="w-5 h-5 text-primary" />
              <h3 className="text-xl font-bold">Régimes alimentaires</h3>
            </div>
            <MultiSelectChip 
              options={DIETS} 
              selected={formData.dietaryPreferences} 
              onChange={(v) => setFormData({...formData, dietaryPreferences: v})} 
            />
          </div>

          <hr className="border-border/50" />

          <div>
            <div className="flex items-center gap-2 mb-4">
              <ChefHat className="w-5 h-5 text-amber-500" />
              <h3 className="text-xl font-bold">Styles de cuisine préférés</h3>
            </div>
            <MultiSelectChip 
              options={CUISINES} 
              selected={formData.cuisinePreferences} 
              onChange={(v) => setFormData({...formData, cuisinePreferences: v})} 
            />
          </div>
        </Card>

        <div className="flex justify-end pt-4 sticky bottom-6 z-10 no-print">
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button size="lg" type="submit" disabled={saveMutation.isPending} className="shadow-2xl shadow-primary/30">
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
