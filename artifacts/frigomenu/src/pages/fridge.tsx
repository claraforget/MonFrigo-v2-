import { useState } from "react";
import { useGetFridgeIngredients, useAddFridgeIngredient, useDeleteFridgeIngredient } from "@workspace/api-client-react";
import { Plus, Search, Trash2, Apple, Beef, Carrot, Milk, Wheat, SearchX } from "lucide-react";
import { Button, Input, Select, Label, Card, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Légumes": <Carrot className="w-5 h-5 text-emerald-500" />,
  "Fruits": <Apple className="w-5 h-5 text-red-500" />,
  "Viandes": <Beef className="w-5 h-5 text-rose-600" />,
  "Produits laitiers": <Milk className="w-5 h-5 text-blue-400" />,
  "Féculents": <Wheat className="w-5 h-5 text-amber-500" />,
};

const CATEGORIES = ["Légumes", "Fruits", "Viandes", "Produits laitiers", "Féculents", "Épices", "Autres"];
const UNITS = ["g", "kg", "ml", "L", "pcs", "tasse", "c.à.s", "c.à.c"];

export default function FridgePage() {
  const { data: ingredients, isLoading } = useGetFridgeIngredients();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("Tous");
  const [isAddOpen, setIsAddOpen] = useState(false);

  const addMutation = useAddFridgeIngredient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/fridge/ingredients"] });
        setIsAddOpen(false);
      }
    }
  });

  const deleteMutation = useDeleteFridgeIngredient({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fridge/ingredients"] })
    }
  });

  const filtered = ingredients?.filter(i => 
    i.name.toLowerCase().includes(search.toLowerCase()) && 
    (filterCat === "Tous" || i.category === filterCat)
  ) || [];

  return (
    <div className="space-y-8">
      {/* Header section with background image */}
      <div className="relative rounded-3xl overflow-hidden min-h-[200px] flex items-center p-8 border border-border/50 shadow-sm">
        <div className="absolute inset-0 z-0">
          <img 
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`} 
            alt="Fresh ingredients background" 
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent" />
        </div>
        
        <div className="relative z-10 max-w-2xl">
          <h1 className="text-4xl font-display font-bold text-foreground">Mon Frigo</h1>
          <p className="text-lg text-muted-foreground mt-2">Gérez vos ingrédients pour des recettes sur mesure.</p>
          
          <div className="mt-6 flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input 
                placeholder="Rechercher un ingrédient..." 
                className="pl-12 bg-background/80 backdrop-blur-md border-border/50"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select 
              value={filterCat} 
              onChange={(e) => setFilterCat(e.target.value)}
              className="sm:w-48 bg-background/80 backdrop-blur-md border-border/50"
            >
              <option value="Tous">Toutes catégories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Button onClick={() => setIsAddOpen(true)} className="whitespace-nowrap">
              <Plus className="w-5 h-5 mr-2" /> Ajouter
            </Button>
          </div>
        </div>
      </div>

      {/* Add Item Form (Inline Expansion for simplicity and elegance) */}
      <AnimatePresence>
        {isAddOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -20 }}
            animate={{ opacity: 1, height: "auto", y: 0 }}
            exit={{ opacity: 0, height: 0, y: -20 }}
            className="overflow-hidden"
          >
            <Card className="p-6 border-primary/20 bg-primary/5">
              <h3 className="text-lg font-bold mb-4">Nouvel ingrédient</h3>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  addMutation.mutate({
                    data: {
                      name: fd.get("name") as string,
                      quantity: fd.get("quantity") as string,
                      unit: fd.get("unit") as string,
                      category: fd.get("category") as string,
                    }
                  });
                }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end"
              >
                <div className="space-y-2 lg:col-span-2">
                  <Label>Nom</Label>
                  <Input name="name" required placeholder="ex: Tomates" autoFocus />
                </div>
                <div className="space-y-2">
                  <Label>Quantité</Label>
                  <Input name="quantity" required placeholder="ex: 500" type="number" step="0.1" />
                </div>
                <div className="space-y-2">
                  <Label>Unité</Label>
                  <Select name="unit">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>
                <div className="space-y-2 lg:col-span-2">
                  <Label>Catégorie</Label>
                  <Select name="category">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
                <div className="flex gap-2 lg:col-span-3 justify-end h-12 items-center">
                  <Button type="button" variant="ghost" onClick={() => setIsAddOpen(false)}>Annuler</Button>
                  <Button type="submit" disabled={addMutation.isPending}>
                    {addMutation.isPending ? "Ajout..." : "Enregistrer"}
                  </Button>
                </div>
              </form>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grid of Ingredients */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-32 bg-muted/50 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center flex flex-col items-center justify-center opacity-80">
          <img 
            src={`${import.meta.env.BASE_URL}images/empty-fridge.png`} 
            alt="Frigo vide" 
            className="w-48 h-48 object-contain mb-6 drop-shadow-xl"
          />
          <h3 className="text-xl font-bold text-foreground">Votre frigo est vide</h3>
          <p className="text-muted-foreground mt-2 max-w-md">
            Commencez par ajouter des ingrédients pour que nous puissions vous suggérer des recettes savoureuses.
          </p>
          <Button onClick={() => setIsAddOpen(true)} className="mt-6" variant="secondary">
            Ajouter un premier ingrédient
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <AnimatePresence>
            {filtered.map((item) => (
              <motion.div
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                key={item.id}
              >
                <Card className="p-5 group hover:border-primary/30 transition-all flex flex-col h-full relative overflow-hidden">
                  <div className="absolute -right-4 -top-4 opacity-5 pointer-events-none transition-transform group-hover:scale-110">
                    {CATEGORY_ICONS[item.category] || <Refrigerator className="w-32 h-32" />}
                  </div>
                  
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className="p-2.5 bg-muted rounded-xl">
                      {CATEGORY_ICONS[item.category] || <div className="w-5 h-5 rounded-full bg-primary" />}
                    </div>
                    <button 
                      onClick={() => deleteMutation.mutate({ id: item.id })}
                      disabled={deleteMutation.isPending}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  
                  <div className="mt-auto relative z-10">
                    <h3 className="font-bold text-lg leading-tight truncate" title={item.name}>{item.name}</h3>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-2xl font-display font-light text-primary">
                        {item.quantity} <span className="text-base text-muted-foreground">{item.unit}</span>
                      </p>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{item.category}</Badge>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
