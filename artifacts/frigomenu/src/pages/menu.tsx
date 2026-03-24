import { useGetCurrentMenu, useGenerateMenu } from "@workspace/api-client-react";
import { Card, Button, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Printer, CalendarDays, Clock, DollarSign, ChevronDown } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Meal } from "@workspace/api-client-react/src/generated/api.schemas";

function MealCard({ title, meal }: { title: string, meal: Meal }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-background/50 hover:bg-background transition-colors print-break-inside-avoid">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="font-bold text-muted-foreground w-16 uppercase tracking-wider text-xs">{title}</span>
          <span className="font-semibold text-foreground text-sm sm:text-base">{meal.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="hidden sm:flex whitespace-nowrap"><Clock className="w-3 h-3 mr-1" /> {meal.cookingTime} min</Badge>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-300 no-print ${expanded ? "rotate-180" : ""}`} />
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
            <div className="p-4 pt-0 border-t border-border/40 mt-2 bg-muted/20">
              <p className="text-sm text-muted-foreground mb-4 italic">{meal.description}</p>
              
              <div className="grid sm:grid-cols-2 gap-6">
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider mb-2 text-foreground/80">Ingrédients</h4>
                  <ul className="space-y-1">
                    {meal.ingredients.map((ing, i) => (
                      <li key={i} className="text-sm flex items-start">
                        <span className="mr-2 text-primary">•</span> 
                        <span className="text-foreground/90">{ing}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-bold text-xs uppercase tracking-wider mb-2 text-foreground/80">Instructions</h4>
                  <ol className="space-y-2 list-decimal list-outside pl-4">
                    {meal.instructions.map((inst, i) => (
                      <li key={i} className="text-sm text-foreground/90 leading-relaxed">{inst}</li>
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
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      <p className="text-muted-foreground animate-pulse">Chargement de votre menu...</p>
    </div>
  );

  const hasMenu = data?.found && data.menu;

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 no-print">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground flex items-center gap-3">
            <CalendarDays className="w-10 h-10 text-primary" />
            Menu de la semaine
          </h1>
          {hasMenu && (
            <p className="text-muted-foreground mt-2 flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Coût estimé: <strong className="text-foreground">{data.menu.estimatedCost} $</strong>
            </p>
          )}
        </div>
        
        <div className="flex gap-3">
          {hasMenu && (
            <Button variant="outline" onClick={handlePrint} className="bg-white">
              <Printer className="w-5 h-5 mr-2" />
              Télécharger PDF
            </Button>
          )}
          <Button 
            onClick={() => generateMutation.mutate()} 
            disabled={generateMutation.isPending}
            className="bg-gradient-to-r from-secondary to-orange-500 hover:from-orange-500 hover:to-secondary border-none"
          >
            <Sparkles className="w-5 h-5 mr-2" />
            {generateMutation.isPending ? "Génération en cours (IA)..." : "Générer un menu"}
          </Button>
        </div>
      </div>

      {/* Print header visible only in PDF */}
      <div className="hidden print:block mb-8 text-center border-b pb-4">
        <h1 className="text-3xl font-bold">FrigoMenu - Votre semaine</h1>
        {hasMenu && <p className="text-gray-500 mt-2">Généré le {new Date(data.menu.generatedAt).toLocaleDateString('fr-CA')}</p>}
      </div>

      {generateMutation.isPending && (
        <div className="py-20 flex flex-col items-center justify-center text-center bg-primary/5 rounded-3xl border border-primary/20 border-dashed">
          <Sparkles className="w-12 h-12 text-secondary animate-bounce mb-4" />
          <h3 className="text-xl font-bold text-primary mb-2">Création de la magie culinaire...</h3>
          <p className="text-muted-foreground max-w-md">L'IA analyse votre frigo et vos préférences pour composer le menu parfait. Cela prend généralement 5 à 10 secondes.</p>
        </div>
      )}

      {!generateMutation.isPending && !hasMenu && (
        <div className="py-20 text-center flex flex-col items-center justify-center opacity-80">
          <img 
            src={`${import.meta.env.BASE_URL}images/empty-menu.png`} 
            alt="Menu vide" 
            className="w-48 h-48 object-contain mb-6 drop-shadow-xl"
          />
          <h3 className="text-2xl font-bold text-foreground">Aucun menu généré</h3>
          <p className="text-muted-foreground mt-2 max-w-md">
            Cliquez sur le bouton ci-dessus pour laisser l'IA créer un menu hebdomadaire adapté à votre frigo et vos goûts.
          </p>
        </div>
      )}

      {!generateMutation.isPending && hasMenu && (
        <div className="space-y-6">
          {data.menu.days.map((day, idx) => (
            <Card key={idx} className="p-0 overflow-hidden border-border/80 print-break-inside-avoid shadow-sm hover:shadow-md transition-shadow">
              <div className="bg-muted/30 px-6 py-4 border-b border-border/50 flex items-center justify-between">
                <h2 className="text-xl font-display font-bold text-foreground">{day.dayName}</h2>
              </div>
              <div className="p-4 sm:p-6 space-y-3">
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
