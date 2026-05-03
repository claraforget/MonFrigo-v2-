import { useState, useRef, useEffect } from "react";
import { useGetFridgeIngredients, useAddFridgeIngredient, useDeleteFridgeIngredient } from "@workspace/api-client-react";
import { Plus, Search, Trash2, Apple, Beef, Carrot, Milk, Wheat, Sprout, Fish, X } from "lucide-react";
import { Button, Input, Select, Label, Card, Badge } from "@/components/ui-elements";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// ─── Icônes ───────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Légumes":              <Carrot className="w-6 h-6 text-emerald-500" />,
  "Fruits":               <Apple  className="w-6 h-6 text-red-500" />,
  "Viandes":              <Beef   className="w-6 h-6 text-rose-600" />,
  "Poissons":             <Fish   className="w-6 h-6 text-cyan-500" />,
  "Produits laitiers":    <Milk   className="w-6 h-6 text-blue-400" />,
  "Féculents":            <Wheat  className="w-6 h-6 text-amber-500" />,
  "Protéines végétales":  <Sprout className="w-6 h-6 text-green-600" />,
};

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIES = ["Légumes", "Fruits", "Viandes", "Poissons", "Produits laitiers", "Féculents", "Protéines végétales", "Épices"];
const UNITS = ["unité", "g", "kg", "ml", "L", "tasse", "c.à.s", "c.à.c"];

// ─── Base d'ingrédients pour l'autocomplétion ─────────────────────────────────

const INGREDIENT_SUGGESTIONS: string[] = [
  // ── Viandes & volailles ──
  "Poulet entier", "Poitrine de poulet", "Cuisse de poulet", "Pilon de poulet",
  "Poulet haché", "Ailes de poulet", "Filet de poulet",
  "Poitrine de poulet surgelée", "Cuisse de poulet surgelée", "Ailes de poulet surgelées",
  "Bœuf haché", "Bœuf haché extra-maigre", "Bifteck de bœuf", "Rôti de bœuf",
  "Côte de bœuf", "Bœuf à ragoût", "Bœuf en cubes surgelé",
  "Porc haché", "Côtelette de porc", "Rôti de porc", "Filet de porc",
  "Bacon", "Bacon de dinde",
  "Veau haché", "Côtelette de veau", "Escalope de veau",
  "Dinde entière", "Poitrine de dinde", "Dinde hachée", "Dinde surgelée",
  "Saucisse italienne", "Saucisse de Francfort", "Saucisse de porc", "Merguez",
  "Jambon cuit", "Jambon fumé", "Prosciutto", "Pepperoni",
  "Agneau haché", "Gigot d'agneau", "Côtelette d'agneau",
  // ── Poissons & fruits de mer ──
  "Saumon frais", "Saumon fumé", "Filet de saumon", "Saumon surgelé", "Saumon sockeye", "Saumon atlantique",
  "Thon en conserve", "Thon en conserve dans l'eau", "Thon en conserve dans l'huile", "Thon frais", "Thon albacore",
  "Crevettes fraîches", "Crevettes surgelées", "Crevettes décortiquées", "Crevettes géantes",
  "Pétoncles frais", "Pétoncles surgelés",
  "Homard frais", "Homard en conserve", "Queue de homard surgelée",
  "Crabe en conserve", "Pattes de crabe surgelées", "Crabe des neiges",
  "Tilapia frais", "Tilapia surgelé", "Filet de tilapia",
  "Morue fraîche", "Morue salée", "Morue surgelée", "Morue charbonnière",
  "Doré frais", "Doré surgelé", "Filet de doré",
  "Truite fraîche", "Truite arc-en-ciel", "Truite fumée", "Truite surgelée",
  "Moules fraîches", "Moules surgelées",
  "Palourdes en conserve", "Palourdes fraîches",
  "Sardines en conserve", "Sardines à l'huile d'olive",
  "Maquereau en conserve", "Maquereau fumé",
  "Flétan frais", "Flétan surgelé", "Filet de flétan",
  "Sole fraîche", "Sole surgelée", "Filet de sole",
  "Pangasius surgelé", "Filet de pangasius",
  "Basa surgelé", "Filet de basa",
  "Mahi-mahi frais", "Mahi-mahi surgelé",
  "Bar rayé frais", "Loup de mer",
  "Dorade royale", "Dorade surgelée",
  "Perche fraîche", "Filet de perche",
  "Espadon frais", "Espadon surgelé",
  "Hareng en conserve", "Hareng fumé", "Harengs marinés",
  "Anchois en conserve", "Anchois à l'huile",
  "Calamars frais", "Calamars surgelés", "Anneaux de calamars",
  "Poulpe frais", "Poulpe surgelé",
  "Huîtres fraîches", "Huîtres en conserve",
  "Langouste surgelée",
  // ── Légumes frais ──
  "Tomate", "Tomates cerises", "Tomates raisins", "Tomate beefsteak",
  "Tomates en dés en conserve", "Tomates broyées en conserve", "Tomates entières en conserve",
  "Tomates séchées", "Tomates séchées dans l'huile",
  "Carotte", "Carottes miniatures", "Carottes surgelées", "Carottes en dés",
  "Oignon jaune", "Oignon rouge", "Oignon vert", "Échalote", "Oignons caramélisés",
  "Ail frais", "Ail en poudre", "Ail haché en pot", "Ail rôti",
  "Poivron rouge", "Poivron vert", "Poivron jaune", "Poivron orange",
  "Poivrons rôtis en conserve", "Poivrons surgelés",
  "Brocoli frais", "Brocoli surgelé", "Fleurons de brocoli",
  "Chou-fleur frais", "Chou-fleur surgelé", "Chou-fleur rôti",
  "Chou vert", "Chou rouge", "Chou frisé (kale)", "Chou de Bruxelles frais", "Chou de Bruxelles surgelé",
  "Épinards frais", "Épinards surgelés", "Épinards en conserve",
  "Roquette", "Laitue romaine", "Laitue Boston", "Laitue frisée", "Mâche", "Mesclun",
  "Concombre", "Concombre libanais", "Concombre anglais",
  "Zucchini", "Courgette jaune", "Zucchini surgelé",
  "Céleri", "Céleri-rave",
  "Poireau", "Fenouil",
  "Aubergine", "Aubergine grillée en conserve",
  "Radis", "Betterave fraîche", "Betterave cuite sous vide", "Betterave en conserve",
  "Champignon blanc", "Champignon cremini", "Champignon portobello", "Shiitake",
  "Champignons en conserve", "Champignons séchés",
  "Pomme de terre", "Pomme de terre grelot", "Pomme de terre Russet",
  "Patate douce", "Patate douce surgelée",
  "Maïs en épi", "Maïs en grains surgelé", "Maïs en conserve",
  "Haricots verts frais", "Haricots verts surgelés", "Haricots verts en conserve",
  "Pois verts frais", "Petits pois surgelés", "Petits pois en conserve",
  "Asperges fraîches", "Asperges surgelées", "Asperges en conserve",
  "Artichaut", "Cœurs d'artichaut en conserve",
  "Endive", "Panais", "Navet", "Rutabaga",
  // ── Fruits frais ──
  "Pomme Fuji", "Pomme Gala", "Pomme Granny Smith", "Pomme Cortland", "Pomme Honeycrisp",
  "Pommes séchées", "Compote de pommes",
  "Banane", "Banane séchée", "Banane plantain",
  "Orange", "Clémentine", "Mandarine", "Pamplemousse",
  "Citron", "Citron Meyer", "Jus de citron",
  "Lime", "Jus de lime",
  "Fraise fraîche", "Fraises surgelées", "Fraises séchées",
  "Bleuet frais", "Bleuets surgelés", "Bleuets séchés",
  "Framboise fraîche", "Framboises surgelées", "Framboises séchées",
  "Mûre fraîche", "Mûres surgelées",
  "Canneberge fraîche", "Canneberges surgelées", "Canneberges séchées",
  "Raisin rouge", "Raisin vert", "Raisins secs",
  "Pêche fraîche", "Pêches surgelées", "Pêches en conserve", "Pêches séchées",
  "Nectarine",
  "Prune fraîche", "Pruneaux séchés",
  "Abricot frais", "Abricots séchés", "Abricots en conserve",
  "Poire fraîche", "Poires en conserve", "Poires séchées",
  "Mangue fraîche", "Mangues surgelées", "Mangues séchées", "Purée de mangue",
  "Ananas frais", "Ananas en conserve", "Ananas surgelé", "Ananas séché",
  "Kiwi", "Kiwi séché",
  "Melon cantaloup", "Melon miel", "Pastèque",
  "Cerise fraîche", "Cerises surgelées", "Cerises en conserve", "Cerises séchées",
  "Avocat",
  "Grenade", "Arilles de grenade", "Jus de grenade",
  "Figue fraîche", "Figues séchées",
  "Papaye fraîche", "Papaye séchée",
  "Goyave", "Litchi", "Fruit du dragon",
  "Noix de coco râpée", "Lait de coco", "Lait de coco léger", "Crème de coco",
  // ── Produits laitiers & œufs ──
  "Lait entier", "Lait 2%", "Lait écrémé",
  "Lait d'amande", "Lait de soya", "Lait d'avoine", "Lait de coco (boisson)",
  "Beurre salé", "Beurre non salé", "Beurre d'arachide", "Beurre de cajou", "Beurre d'amande",
  "Crème 35%", "Crème 15%", "Crème sure", "Crème fraîche",
  "Yogourt nature", "Yogourt grec", "Yogourt à la vanille", "Yogourt aux fraises",
  "Fromage cheddar", "Fromage cheddar fort", "Fromage mozzarella", "Fromage parmesan râpé",
  "Fromage ricotta", "Fromage cottage", "Fromage feta", "Fromage brie",
  "Fromage camembert", "Fromage gruyère", "Fromage suisse", "Fromage havarti",
  "Fromage à la crème", "Fromage en grains",
  "Œufs", "Blancs d'œufs", "Œufs durs",
  // ── Féculents & légumineuses ──
  "Riz blanc", "Riz brun", "Riz basmati", "Riz jasmin", "Riz sauvage", "Riz arborio",
  "Pâtes spaghetti", "Pâtes penne", "Pâtes fusilli", "Pâtes rigatoni",
  "Pâtes farfalle", "Pâtes linguine", "Pâtes tagliatelle", "Pâtes orzo",
  "Pain de blé entier", "Pain blanc", "Pain baguette", "Pain ciabatta", "Pain pita",
  "Pain naan", "Tortillas de blé", "Tortillas de maïs",
  "Farine tout usage", "Farine de blé entier", "Farine de riz", "Farine d'amande",
  "Quinoa", "Quinoa tricolore",
  "Couscous", "Couscous de blé entier",
  "Orge perlé", "Avoine à cuisson rapide", "Gruau", "Flocons d'avoine",
  "Lentilles vertes", "Lentilles rouges", "Lentilles beluga",
  "Pois chiches en conserve", "Pois chiches secs",
  "Haricots noirs en conserve", "Haricots noirs secs",
  "Haricots rouges en conserve", "Haricots rouges secs",
  "Haricots blancs en conserve", "Haricots blancs secs",
  "Polenta", "Semoule de maïs",
  // ── Épices, herbes & condiments ──
  "Sel", "Sel de mer", "Fleur de sel",
  "Poivre noir moulu", "Poivre blanc", "Poivre en grains",
  "Paprika doux", "Paprika fumé", "Paprika fort",
  "Cumin moulu", "Graines de cumin",
  "Curcuma", "Curry en poudre", "Garam masala",
  "Cannelle moulue", "Bâtons de cannelle",
  "Muscade moulue", "Clou de girofle",
  "Gingembre frais", "Gingembre moulu", "Gingembre confit",
  "Basilic frais", "Basilic séché",
  "Origan séché", "Thym séché", "Thym frais",
  "Romarin séché", "Romarin frais",
  "Persil frais", "Persil séché",
  "Coriandre fraîche", "Coriandre moulue",
  "Laurier", "Estragon séché", "Herbes de Provence", "Fines herbes",
  "Piment de Cayenne", "Flocons de piment rouge", "Piment jalapeño",
  "Sauce soya", "Tamari", "Sauce Worcestershire", "Sauce tabasco", "Sauce sriracha",
  "Sauce hoisin", "Sauce teriyaki", "Sauce fish",
  "Vinaigre blanc", "Vinaigre de cidre", "Vinaigre balsamique", "Vinaigre de riz",
  "Huile d'olive", "Huile d'olive extra vierge", "Huile de canola", "Huile de sésame",
  "Moutarde de Dijon", "Moutarde jaune", "Moutarde à l'ancienne",
  "Mayonnaise", "Ketchup", "Relish",
  "Miel", "Miel de trèfle",
  "Sirop d'érable", "Sucre blanc", "Sucre brun", "Cassonade", "Sucre glace",
  // ── Bouillons & sauces ──
  "Bouillon de poulet", "Bouillon de bœuf", "Bouillon de légumes",
  "Sauce tomate", "Passata de tomate", "Concentré de tomate",
  // ── Protéines végétales ──
  "Tofu ferme", "Tofu extra-ferme", "Tofu soyeux", "Tofu fumé", "Tofu soyeux nature",
  "Tempeh nature", "Tempeh mariné", "Tempeh aux herbes",
  "Seitan", "Seitan tranché",
  "Edamame surgelé", "Edamame frais", "Edamame décortiqué",
  "Lentilles vertes", "Lentilles rouges", "Lentilles beluga", "Lentilles du Puy",
  "Pois chiches en conserve", "Pois chiches secs", "Pois chiches rôtis",
  "Haricots noirs en conserve", "Haricots noirs secs",
  "Haricots rouges en conserve", "Haricots rouges secs",
  "Haricots blancs en conserve", "Haricots blancs secs",
  "Fèves edamames", "Fèves sèches", "Pois cassés",
  "Protéine de soya texturée (PST)", "Protéine végétale texturée",
  "Haricots de Lima", "Haricots pinto",
  // ── Noix & graines (protéines végétales) ──
  "Amandes entières", "Amandes effilées", "Amandes en poudre", "Amandes grillées",
  "Noix de cajou", "Noix de cajou grillées",
  "Arachides", "Arachides grillées",
  "Pacanes", "Noix de Grenoble", "Noisettes", "Pistaches",
  "Graines de sésame", "Graines de lin", "Graines de chia", "Graines de citrouille", "Graines de tournesol",
  "Tahini (beurre de sésame)",
  // ── Pâtisserie & divers ──
  "Levure chimique", "Bicarbonate de soude", "Levure instantanée",
  "Chocolat noir", "Chocolat au lait", "Chocolat blanc", "Cacao en poudre", "Pépites de chocolat",
  "Extrait de vanille", "Gousse de vanille",
];

// ─── Détection auto de catégorie ──────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Protéines végétales": ["tofu", "tempeh", "seitan", "edamame", "lentille", "pois chiche", "haricot noir", "haricot rouge", "haricot blanc", "haricot de lima", "haricot pinto", "fève", "pois cassé", "protéine végét", "protéine de soya", "pst", "légumineuse", "amande", "noix de cajou", "arachide", "pacane", "noisette", "pistache", "noix de grenoble", "graine de chia", "graine de lin", "graine de citrouille", "graine de sésame", "graine de tournesol", "tahini"],
  "Poissons": ["saumon", "thon", "crevette", "pétoncle", "homard", "crabe", "tilapia", "morue", "doré", "truite", "moule", "palourde", "sardine", "maquereau", "flétan", "sole", "pangasius", "basa", "mahi-mahi", "bar rayé", "loup de mer", "dorade", "perche", "espadon", "hareng", "anchois", "calmar", "poulpe", "huître", "langouste", "fruits de mer", "poisson", "filet de"],
  "Légumes": ["tomate", "carotte", "oignon", "ail", "poivron", "brocoli", "épinard", "laitue", "concombre", "céleri", "poireau", "courgette", "aubergine", "haricot vert", "pois vert", "maïs", "pomme de terre", "patate", "navet", "radis", "betterave", "asperge", "artichaut", "chou", "endive", "fenouil", "panais", "champignon", "zucchini", "roquette", "mâche", "shiitake", "rutabaga", "pak choï", "bok choy"],
  "Fruits": ["pomme", "banane", "orange", "citron", "lime", "fraise", "bleuet", "framboise", "raisin", "pêche", "poire", "mangue", "ananas", "melon", "pastèque", "cerise", "abricot", "kiwi", "grenade", "figue", "prune", "canneberge", "avocat", "nectarine", "pamplemousse", "mûre", "papaye", "goyave", "litchi", "noix de coco", "clémentine", "mandarine"],
  "Viandes": ["poulet", "bœuf", "boeuf", "porc", "dinde", "veau", "agneau", "bacon", "saucisse", "jambon", "prosciutto", "merguez", "pepperoni", "côtelette", "rôti de", "gigot", "bifteck", "viande"],
  "Produits laitiers": ["lait", "fromage", "yaourt", "yogourt", "beurre", "crème", "œuf", "oeuf", "mozzarella", "cheddar", "parmesan", "ricotta", "cottage", "féta", "brie", "camembert", "gruyère", "havarti"],
  "Féculents": ["riz", "pâtes", "pain", "farine", "couscous", "quinoa", "orge", "avoine", "gruau", "céréale", "blé", "semoule", "polenta", "tortilla", "naan", "pita"],
  "Épices": ["sel", "poivre", "cumin", "paprika", "curcuma", "cannelle", "gingembre", "basilic", "thym", "origan", "persil", "coriandre", "laurier", "romarin", "estragon", "muscade", "piment", "cayenne", "safran", "herbe", "moutarde", "mayonnaise", "ketchup", "vinaigre", "sauce", "huile", "miel", "sirop d'érable", "sucre", "cassonade", "vanille", "levure", "bicarbonate", "cacao", "chocolat", "curry", "garam", "bouillon"],
};

function detectCategory(name: string): string {
  const lower = name.toLowerCase().trim();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return category;
  }
  return "Légumes";
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
                  <span className="ml-auto text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-lg shrink-0">
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
          <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)} className="sm:w-48 bg-card">
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
                <div className="space-y-2 lg:col-span-2">
                  <Label>Catégorie</Label>
                  <Select name="category" className="bg-white" value={formCategory} onChange={(e) => setFormCategory(e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
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
            {filtered.map((item) => (
              <motion.div layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} key={item.id}>
                <Card className="p-6 hover:shadow-md transition-all flex flex-col h-full relative overflow-hidden bg-card">
                  <div className="absolute -right-6 -bottom-6 opacity-[0.03] pointer-events-none">
                    {CATEGORY_ICONS[item.category] || <Sprout className="w-40 h-40" />}
                  </div>
                  <div className="flex justify-between items-start mb-4 relative z-10">
                    <div className="p-3 bg-muted/50 rounded-2xl">
                      {CATEGORY_ICONS[item.category] || <Sprout className="w-6 h-6 text-muted-foreground" />}
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
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-2xl font-display font-medium text-foreground/90">
                        {item.quantity} <span className="text-lg text-muted-foreground font-normal">{item.unit}</span>
                      </p>
                      <Badge variant="outline" className="text-[11px] font-medium uppercase tracking-wider bg-background/50 border-none">
                        {item.category}
                      </Badge>
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
