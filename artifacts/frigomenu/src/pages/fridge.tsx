import { useState, useRef, useEffect } from "react";
import { useGetFridgeIngredients, useAddFridgeIngredient, useDeleteFridgeIngredient } from "@workspace/api-client-react";
import { Plus, Search, Trash2, Apple, Beef, Carrot, Milk, Wheat, Package, Snowflake, Flame, Archive, Leaf, X } from "lucide-react";
import { Button, Input, Select, Label, Card, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// ─── Icônes ──────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Légumes": <Carrot className="w-6 h-6 text-emerald-500" />,
  "Fruits": <Apple className="w-6 h-6 text-red-500" />,
  "Viandes": <Beef className="w-6 h-6 text-rose-600" />,
  "Produits laitiers": <Milk className="w-6 h-6 text-blue-400" />,
  "Féculents": <Wheat className="w-6 h-6 text-amber-500" />,
};

const CONSERVATION_ICONS: Record<string, React.ReactNode> = {
  "frais":       <Leaf    className="w-3.5 h-3.5" />,
  "surgelé":     <Snowflake className="w-3.5 h-3.5" />,
  "en conserve": <Archive className="w-3.5 h-3.5" />,
  "séché":       <Flame   className="w-3.5 h-3.5" />,
  "cuit":        <Flame   className="w-3.5 h-3.5" />,
};

const CONSERVATION_COLORS: Record<string, string> = {
  "frais":       "bg-green-100 text-green-700 border-green-200",
  "surgelé":     "bg-blue-100 text-blue-700 border-blue-200",
  "en conserve": "bg-amber-100 text-amber-700 border-amber-200",
  "séché":       "bg-orange-100 text-orange-700 border-orange-200",
  "cuit":        "bg-red-100 text-red-700 border-red-200",
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const CONSERVATION_TYPES = ["frais", "surgelé", "en conserve", "séché", "cuit"];
const CATEGORIES = ["Légumes", "Fruits", "Viandes", "Produits laitiers", "Féculents", "Épices", "Autres"];
const UNITS = ["unité", "g", "kg", "ml", "L", "tasse", "c.à.s", "c.à.c"];

// ─── Base d'ingrédients pour l'autocomplétion ─────────────────────────────────

const INGREDIENT_SUGGESTIONS: string[] = [
  // Viandes & volailles
  "Poulet entier", "Poitrine de poulet", "Cuisse de poulet", "Pilon de poulet",
  "Poulet haché", "Ailes de poulet", "Filet de poulet",
  "Bœuf haché", "Bifteck de bœuf", "Rôti de bœuf", "Côte de bœuf",
  "Porc haché", "Côtelette de porc", "Rôti de porc", "Filet de porc", "Bacon",
  "Veau haché", "Côtelette de veau",
  "Dinde entière", "Poitrine de dinde", "Dinde hachée",
  "Saucisse italienne", "Saucisse de Francfort", "Merguez",
  "Jambon cuit", "Jambon fumé", "Prosciutto",
  "Agneau haché", "Gigot d'agneau",
  // Poissons & fruits de mer
  "Saumon frais", "Saumon fumé", "Filet de saumon",
  "Thon en conserve", "Thon frais",
  "Crevettes", "Pétoncles", "Homard", "Crabe",
  "Tilapia", "Morue", "Doré", "Truite",
  "Moules", "Palourdes",
  // Légumes
  "Tomate", "Tomates cerises", "Tomates en dés", "Tomates broyées",
  "Carotte", "Carottes miniatures",
  "Oignon jaune", "Oignon rouge", "Oignon vert", "Échalote",
  "Ail", "Ail en poudre",
  "Poivron rouge", "Poivron vert", "Poivron jaune",
  "Brocoli", "Chou-fleur", "Chou vert", "Chou rouge", "Chou kale",
  "Épinards", "Roquette", "Laitue romaine", "Laitue Boston", "Mâche",
  "Concombre", "Zucchini", "Courgette",
  "Céleri", "Poireau", "Fenouil",
  "Aubergine", "Radis", "Betterave",
  "Champignon blanc", "Champignon portobello", "Shiitake",
  "Pomme de terre", "Patate douce", "Pomme de terre grelot",
  "Maïs", "Maïs en conserve", "Haricots verts",
  "Pois verts", "Petits pois", "Asperges",
  "Artichaut", "Endive", "Panais", "Navet",
  // Fruits
  "Pomme", "Pomme Fuji", "Pomme Gala", "Pomme Granny Smith",
  "Banane", "Orange", "Citron", "Lime", "Pamplemousse",
  "Fraise", "Bleuet", "Framboise", "Mûre", "Canneberge",
  "Raisin rouge", "Raisin vert",
  "Pêche", "Nectarine", "Prune", "Abricot",
  "Poire", "Mangue", "Ananas", "Kiwi",
  "Melon", "Pastèque", "Grenade", "Figue",
  "Cerise", "Avocat",
  // Produits laitiers & œufs
  "Lait entier", "Lait 2%", "Lait écrémé", "Lait d'amande", "Lait de soya",
  "Beurre", "Beurre salé", "Beurre non salé",
  "Crème 35%", "Crème 15%", "Crème sure", "Crème fraîche",
  "Yogourt nature", "Yogourt grec", "Yogourt à la vanille",
  "Fromage cheddar", "Fromage mozzarella", "Fromage parmesan",
  "Fromage ricotta", "Fromage cottage", "Fromage feta",
  "Fromage brie", "Fromage camembert", "Fromage gruyère",
  "Œufs", "Blancs d'œufs",
  // Féculents & légumineuses
  "Riz blanc", "Riz brun", "Riz basmati", "Riz jasmin",
  "Pâtes spaghetti", "Pâtes penne", "Pâtes fusilli", "Pâtes rigatoni",
  "Pain de blé", "Pain blanc", "Pain baguette", "Pain pita",
  "Farine tout usage", "Farine de blé entier",
  "Quinoa", "Couscous", "Orge", "Avoine", "Gruau",
  "Lentilles vertes", "Lentilles rouges",
  "Pois chiches", "Haricots noirs", "Haricots rouges", "Haricots blancs",
  "Polenta", "Semoule",
  // Épices & condiments
  "Sel", "Poivre noir", "Poivre blanc",
  "Paprika", "Paprika fumé", "Cumin", "Curcuma",
  "Cannelle", "Muscade", "Gingembre", "Gingembre frais",
  "Basilic", "Origan", "Thym", "Romarin", "Persil", "Coriandre",
  "Laurier", "Estragon", "Herbes de Provence",
  "Piment de Cayenne", "Piment fort", "Flocons de piment",
  "Ail en poudre", "Oignon en poudre",
  "Sauce soya", "Sauce Worcester", "Sauce tabasco",
  "Vinaigre blanc", "Vinaigre de cidre", "Vinaigre balsamique",
  "Huile d'olive", "Huile de canola", "Huile de sésame",
  "Moutarde de Dijon", "Moutarde jaune", "Mayonnaise", "Ketchup",
  "Miel", "Sirop d'érable", "Sucre blanc", "Sucre brun", "Cassonade",
  // Bouillons & sauces
  "Bouillon de poulet", "Bouillon de bœuf", "Bouillon de légumes",
  "Sauce tomate", "Passata", "Concentré de tomate",
  "Lait de coco", "Lait de coco léger",
  // Divers
  "Levure chimique", "Bicarbonate de soude", "Levure instantanée",
  "Chocolat noir", "Chocolat au lait", "Cacao en poudre",
  "Vanille", "Extrait de vanille",
  "Amande", "Noix de cajou", "Arachide", "Pacane", "Noix de Grenoble",
  "Graines de sésame", "Graines de lin", "Graines de chia",
];

// ─── Détection auto de catégorie ──────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Légumes": ["tomate", "carotte", "oignon", "ail", "poivron", "brocoli", "épinard", "laitue", "concombre", "céleri", "poireau", "courgette", "aubergine", "haricot vert", "pois vert", "maïs", "pomme de terre", "patate", "navet", "radis", "betterave", "asperge", "artichaut", "chou", "endive", "fenouil", "panais", "champignon", "zucchini", "roquette", "mâche", "shiitake"],
  "Fruits": ["pomme", "banane", "orange", "citron", "lime", "fraise", "bleuet", "framboise", "raisin", "pêche", "poire", "mangue", "ananas", "melon", "pastèque", "cerise", "abricot", "kiwi", "grenade", "figue", "prune", "canneberge", "avocat", "nectarine", "pamplemousse", "mûre"],
  "Viandes": ["poulet", "bœuf", "boeuf", "porc", "dinde", "veau", "agneau", "bacon", "saucisse", "jambon", "prosciutto", "merguez", "saumon", "thon", "crevette", "pétoncle", "homard", "crabe", "tilapia", "morue", "doré", "truite", "moule", "palourde", "poisson", "volaille", "viande", "filet", "côtelette", "rôti", "gigot", "bifteck"],
  "Produits laitiers": ["lait", "fromage", "yaourt", "yogourt", "beurre", "crème", "œuf", "oeuf", "mozzarella", "cheddar", "parmesan", "ricotta", "cottage", "féta", "brie", "camembert", "gruyère"],
  "Féculents": ["riz", "pâte", "pain", "farine", "couscous", "quinoa", "orge", "avoine", "gruau", "céréale", "blé", "semoule", "polenta", "lentille", "pois chiche", "haricot noir", "haricot rouge", "haricot blanc"],
  "Épices": ["sel", "poivre", "cumin", "paprika", "curcuma", "cannelle", "gingembre", "basilic", "thym", "origan", "persil", "coriandre", "laurier", "romarin", "estragon", "muscade", "piment", "cayenne", "safran", "herbe", "épice", "moutarde", "mayonnaise", "ketchup", "vinaigre", "sauce", "huile", "miel", "sirop", "sucre", "cassonade", "vanille", "levure", "bicarbonate", "cacao", "chocolat"],
};

function detectCategory(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return category;
  }
  return "Autres";
}

// ─── Composant autocomplétion ─────────────────────────────────────────────────

function SearchAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (suggestion: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const suggestions = value.trim().length >= 2
    ? INGREDIENT_SUGGESTIONS.filter(s =>
        s.toLowerCase().includes(value.toLowerCase())
      ).slice(0, 8)
    : [];

  const showDropdown = focused && suggestions.length > 0;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative flex-1">
      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
      <Input
        placeholder="Rechercher ou ajouter un ingrédient..."
        className="pl-12 pr-10 bg-card"
        value={value}
        onChange={(e) => { onChange(e.target.value); setFocused(true); }}
        onFocus={() => setFocused(true)}
      />
      {value && (
        <button
          onClick={() => { onChange(""); setFocused(false); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 bg-card border border-border/60 rounded-2xl shadow-xl z-50 overflow-hidden"
          >
            {suggestions.map((s, i) => {
              const lower = value.toLowerCase();
              const idx = s.toLowerCase().indexOf(lower);
              return (
                <button
                  key={i}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(s);
                    setFocused(false);
                  }}
                  className="w-full text-left px-5 py-3 hover:bg-primary/5 transition-colors flex items-center gap-3 border-b border-border/30 last:border-0"
                >
                  <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm">
                    {idx >= 0 ? (
                      <>
                        {s.slice(0, idx)}
                        <strong className="text-primary">{s.slice(idx, idx + lower.length)}</strong>
                        {s.slice(idx + lower.length)}
                      </>
                    ) : s}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-lg">
                    {detectCategory(s)}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function FridgePage() {
  const { data: ingredients, isLoading } = useGetFridgeIngredients();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("Tous");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("Légumes");

  const handleNameChange = (value: string) => {
    setFormName(value);
    if (value.trim().length >= 2) setFormCategory(detectCategory(value));
  };

  const resetForm = () => { setFormName(""); setFormCategory("Légumes"); };

  // Quand l'utilisateur clique une suggestion dans la barre de recherche
  const handleSuggestionSelect = (suggestion: string) => {
    setSearch(suggestion);
    setFormName(suggestion);
    setFormCategory(detectCategory(suggestion));
    setIsAddOpen(true);
  };

  const addMutation = useAddFridgeIngredient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/fridge/ingredients"] });
        setIsAddOpen(false);
        setSearch("");
        resetForm();
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
    <div className="space-y-10">
      {/* En-tête */}
      <div className="pt-4 pb-2">
        <h1 className="text-4xl font-display font-bold text-foreground">Mon Frigo</h1>
        <p className="text-lg text-muted-foreground mt-2">Gérez vos ingrédients pour des recettes sur mesure.</p>

        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          <SearchAutocomplete
            value={search}
            onChange={setSearch}
            onSelect={handleSuggestionSelect}
          />
          <Select
            value={filterCat}
            onChange={(e) => setFilterCat(e.target.value)}
            className="sm:w-48 bg-card"
          >
            <option value="Tous">Toutes catégories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Button onClick={() => { setIsAddOpen(true); resetForm(); }} className="whitespace-nowrap">
            <Plus className="w-5 h-5 mr-2" /> Ajouter
          </Button>
        </div>
      </div>

      {/* Formulaire d'ajout */}
      <AnimatePresence>
        {isAddOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
            onAnimationComplete={() => {
              if (document.activeElement !== nameInputRef.current) {
                nameInputRef.current?.focus();
              }
            }}
          >
            <Card className="p-8 mb-6 bg-primary/5 border-primary/10 shadow-none">
              <h3 className="text-xl font-bold mb-6 text-foreground">Nouvel ingrédient</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  addMutation.mutate({
                    data: {
                      name: fd.get("name") as string,
                      quantity: fd.get("quantity") as string,
                      unit: fd.get("unit") as string,
                      category: formCategory,
                      conservationType: fd.get("conservationType") as string,
                    }
                  });
                }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 items-end"
              >
                {/* Nom */}
                <div className="space-y-2 lg:col-span-2">
                  <Label>Nom</Label>
                  <Input
                    ref={nameInputRef}
                    name="name"
                    required
                    placeholder="ex: Tomates cerises"
                    className="bg-white"
                    value={formName}
                    onChange={(e) => handleNameChange(e.target.value)}
                  />
                  {formName.trim().length >= 2 && (
                    <p className="text-xs text-primary font-medium flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                      Catégorie détectée : {formCategory}
                    </p>
                  )}
                </div>

                {/* Quantité */}
                <div className="space-y-2 lg:col-span-1">
                  <Label>Quantité</Label>
                  <Input name="quantity" required placeholder="ex: 500" type="number" step="0.1" min="0" className="bg-white" />
                </div>

                {/* Unité */}
                <div className="space-y-2 lg:col-span-1">
                  <Label>Unité</Label>
                  <Select name="unit" className="bg-white">
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </div>

                {/* Catégorie */}
                <div className="space-y-2 lg:col-span-1">
                  <Label>Catégorie</Label>
                  <Select name="category" className="bg-white" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>

                {/* Conservation */}
                <div className="space-y-2 lg:col-span-1">
                  <Label>Conservation</Label>
                  <Select name="conservationType" className="bg-white">
                    {CONSERVATION_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </Select>
                </div>

                <div className="flex gap-3 lg:col-span-6 justify-end pt-2">
                  <Button type="button" variant="ghost" onClick={() => { setIsAddOpen(false); resetForm(); }}>Annuler</Button>
                  <Button type="submit" disabled={addMutation.isPending}>
                    {addMutation.isPending ? "Ajout..." : "Enregistrer"}
                  </Button>
                </div>
              </form>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grille d'ingrédients */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-36 bg-muted/50 rounded-3xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center flex flex-col items-center justify-center opacity-80">
          <img
            src={`${import.meta.env.BASE_URL}images/empty-fridge.png`}
            alt="Frigo vide"
            className="w-48 h-48 object-contain mb-8 drop-shadow-xl"
          />
          <h3 className="text-2xl font-bold text-foreground">
            {search ? `Aucun résultat pour "${search}"` : "Votre frigo est vide"}
          </h3>
          <p className="text-muted-foreground mt-3 max-w-md text-lg">
            {search
              ? "Cet ingrédient n'est pas encore dans votre frigo."
              : "Commencez par ajouter des ingrédients pour que nous puissions vous suggérer des recettes."}
          </p>
          <Button
            onClick={() => {
              if (search) { setFormName(search); setFormCategory(detectCategory(search)); }
              setIsAddOpen(true);
            }}
            className="mt-8" variant="secondary" size="lg"
          >
            <Plus className="w-5 h-5 mr-2" />
            {search ? `Ajouter "${search}"` : "Ajouter un premier ingrédient"}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <AnimatePresence>
            {filtered.map((item) => {
              const conservColor = CONSERVATION_COLORS[item.conservationType] ?? "bg-muted text-muted-foreground border-border";
              const conservIcon = CONSERVATION_ICONS[item.conservationType];
              return (
                <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} key={item.id}>
                  <Card className="p-6 hover:shadow-md transition-all flex flex-col h-full relative overflow-hidden bg-card">
                    <div className="absolute -right-6 -bottom-6 opacity-[0.03] pointer-events-none">
                      {CATEGORY_ICONS[item.category] || <Package className="w-40 h-40" />}
                    </div>
                    <div className="flex justify-between items-start mb-4 relative z-10">
                      <div className="p-3 bg-muted/50 rounded-2xl">
                        {CATEGORY_ICONS[item.category] || <Package className="w-6 h-6 text-muted-foreground" />}
                      </div>
                      <button
                        onClick={() => deleteMutation.mutate({ id: item.id })}
                        disabled={deleteMutation.isPending}
                        className="p-2.5 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="mt-auto relative z-10">
                      <h3 className="font-bold text-xl leading-tight truncate mb-1" title={item.name}>{item.name}</h3>
                      <p className="text-2xl font-display font-medium text-foreground/90 mb-3">
                        {item.quantity} <span className="text-lg text-muted-foreground font-normal">{item.unit}</span>
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-xl border ${conservColor}`}>
                          {conservIcon}
                          {item.conservationType.charAt(0).toUpperCase() + item.conservationType.slice(1)}
                        </span>
                        <Badge variant="outline" className="text-[11px] font-medium uppercase tracking-wider bg-background/50 border-none">
                          {item.category}
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
