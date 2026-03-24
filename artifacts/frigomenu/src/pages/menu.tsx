import { useGetCurrentMenu, useGenerateMenu } from "@workspace/api-client-react";
import { Card, Button, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Printer, CalendarDays, Clock, DollarSign, ChevronDown, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Meal } from "@workspace/api-client-react/src/generated/api.schemas";

function MealCard({ title, meal }: { title: string, meal: Meal }) {
  const [expanded, setExpanded] = useState(false);

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
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="hidden sm:flex whitespace-nowrap bg-background/50 border-none">
            <Clock className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" /> {meal.cookingTime} min
          </Badge>
          <div className={`p-1.5 rounded-full transition-colors ${expanded ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground'}`}>
            <ChevronDown className={`w-4 h-4 transition-transform duration-300 no-print ${expanded ? "rotate-180" : ""}`} />
          </div>
        </div>
      </button>
      
      <AnimatePresence>
        {(expanded || window.matchMedia("print").matches) && ( // Force open in print
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
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
  const generateMutation = useGenerateMenu({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/menu/current"] })
    }
  });

  const handlePrint = () => {
    window.print();
  };

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
            <Button variant="outline" onClick={handlePrint} className="bg-card">
              <Printer className="w-5 h-5 mr-2" />
              Télécharger PDF
            </Button>
          )}
          <Button 
            onClick={() => generateMutation.mutate()} 
            disabled={generateMutation.isPending}
            size="lg"
            className="w-full sm:w-auto"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            {generateMutation.isPending ? "Génération en cours..." : "Générer un menu"}
          </Button>
        </div>
      </div>

      {/* Print header visible only in PDF */}
      <div className="hidden print:block mb-8 text-center border-b pb-4">
        <h1 className="text-3xl font-bold">FrigoMenu - Votre semaine</h1>
        {hasMenu && <p className="text-gray-500 mt-2">Généré le {new Date(data.menu.generatedAt).toLocaleDateString('fr-CA')}</p>}
      </div>

      {generateMutation.isPending && (
        <div className="py-24 flex flex-col items-center justify-center text-center bg-primary/5 rounded-[2rem] border border-primary/10">
          <div className="p-4 bg-primary/10 rounded-2xl mb-6">
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
          </div>
          <h3 className="text-2xl font-bold text-foreground mb-3">Création de la magie culinaire...</h3>
          <p className="text-muted-foreground max-w-md text-lg">L'IA analyse votre frigo et vos préférences pour composer le menu parfait. Cela prend généralement 5 à 10 secondes.</p>
        </div>
      )}

      {!generateMutation.isPending && !hasMenu && (
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

      {!generateMutation.isPending && hasMenu && (
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
