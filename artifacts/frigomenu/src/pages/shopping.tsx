import { useGetShoppingList, useGetNearbyStores } from "@workspace/api-client-react";
import { Card, Button } from "@/components/ui-elements";
import { useGeolocation } from "@/hooks/use-geolocation";
import {
  ShoppingBag, MapPin, Store, Navigation, CheckCircle2, Circle, Download,
  ShoppingCart, TrendingDown, Leaf, X, ExternalLink, ChevronRight, ArrowRight
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import { useState, useCallback } from "react";

/* ─── Store search URL builders ───────────────────────────────────────────── */
type StoreKey = "iga" | "metro" | "maxi" | "walmart";

const STORE_CONFIG: Record<StoreKey, {
  label: string; bg: string; text: string; border: string;
  homeUrl: string; searchUrl: (q: string) => string;
  logo: JSX.Element;
}> = {
  iga: {
    label: "IGA",
    bg: "bg-[#e30613]", text: "text-white", border: "border-[#e30613]",
    homeUrl: "https://www.iga.net/fr/epicerie-en-ligne",
    searchUrl: q => `https://www.iga.net/fr/search?k=${encodeURIComponent(q)}`,
    logo: (
      <svg viewBox="0 0 60 28" className="h-7 w-auto" aria-label="IGA">
        <rect width="60" height="28" rx="3" fill="#e30613"/>
        <text x="30" y="20" textAnchor="middle" fill="white" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="16">IGA</text>
      </svg>
    ),
  },
  metro: {
    label: "Metro",
    bg: "bg-[#003da5]", text: "text-white", border: "border-[#003da5]",
    homeUrl: "https://www.metro.ca/epicerie-en-ligne",
    searchUrl: q => `https://www.metro.ca/epicerie-en-ligne/recherche?filter=${encodeURIComponent(q)}`,
    logo: (
      <svg viewBox="0 0 80 28" className="h-7 w-auto" aria-label="Metro">
        <rect width="80" height="28" rx="3" fill="#003da5"/>
        <text x="40" y="20" textAnchor="middle" fill="white" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="14">METRO</text>
      </svg>
    ),
  },
  maxi: {
    label: "Maxi",
    bg: "bg-[#ffe400]", text: "text-black", border: "border-[#ffe400]",
    homeUrl: "https://www.maxi.ca",
    searchUrl: q => `https://www.maxi.ca/fr/recherche?search-bar=${encodeURIComponent(q)}`,
    logo: (
      <svg viewBox="0 0 70 28" className="h-7 w-auto" aria-label="Maxi">
        <rect width="70" height="28" rx="3" fill="#ffe400"/>
        <text x="35" y="20" textAnchor="middle" fill="#000" fontFamily="Arial Black,Arial" fontWeight="900" fontSize="15">maxi</text>
      </svg>
    ),
  },
  walmart: {
    label: "Walmart",
    bg: "bg-[#0071ce]", text: "text-white", border: "border-[#0071ce]",
    homeUrl: "https://www.walmart.ca/fr/epicerie",
    searchUrl: q => `https://www.walmart.ca/fr/recherche?q=${encodeURIComponent(q)}`,
    logo: (
      <svg viewBox="0 0 100 28" className="h-7 w-auto" aria-label="Walmart">
        <rect width="100" height="28" rx="3" fill="#0071ce"/>
        <text x="50" y="20" textAnchor="middle" fill="white" fontFamily="Arial,sans-serif" fontWeight="700" fontSize="13">✦ Walmart</text>
      </svg>
    ),
  },
};

/* ─── Guided Cart Modal ────────────────────────────────────────────────────── */
function GuidedCartModal({ list, onClose }: {
  list: Array<{ name: string; quantity: string; unit: string; category: string; inFridge: boolean; estimatedPrice: number }>;
  onClose: () => void;
}) {
  const [selectedStore, setSelectedStore] = useState<StoreKey | null>(null);
  const [searched, setSearched] = useState<Set<string>>(new Set());

  const items = list.filter(i => !i.inFridge);
  const store = selectedStore ? STORE_CONFIG[selectedStore] : null;

  const openSearch = useCallback((itemName: string) => {
    if (!store) return;
    window.open(store.searchUrl(itemName), "_blank", "noopener,noreferrer");
    setSearched(prev => new Set([...prev, itemName]));
  }, [store]);

  const doneCount = searched.size;
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="bg-card rounded-t-3xl sm:rounded-3xl shadow-2xl border border-border/50 w-full sm:max-w-lg flex flex-col overflow-hidden"
        style={{ maxHeight: "90vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-foreground">Commander en ligne</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{items.length} articles à ajouter au panier</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!selectedStore ? (
          /* Step 1: Choose store */
          <div className="px-6 pb-8 flex-1 overflow-y-auto">
            <p className="text-sm font-semibold text-foreground mb-4">Choisissez votre épicerie :</p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(STORE_CONFIG) as StoreKey[]).map(key => {
                const s = STORE_CONFIG[key];
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedStore(key)}
                    className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-border/30 hover:border-primary/50 hover:shadow-md transition-all bg-card group"
                  >
                    {s.logo}
                    <span className="text-xs text-muted-foreground text-center leading-tight group-hover:text-foreground transition-colors">
                      Recherche article par article
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-6 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-2xl">
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <strong>Comment ça fonctionne :</strong> Pour chaque article, on ouvre la page de recherche de l'épicerie dans un nouvel onglet. Vous n'avez qu'à cliquer "Ajouter au panier" sur la page qui s'ouvre, puis revenir ici pour l'article suivant.
              </p>
              <p className="text-xs text-amber-700/70 dark:text-amber-400/60 mt-2">
                Note : Aucune épicerie québécoise n'offre d'API publique permettant d'ajouter directement au panier — c'est la méthode la plus rapide disponible.
              </p>
            </div>
          </div>
        ) : (
          /* Step 2: Add items one by one */
          <>
            {/* Store header + progress */}
            <div className="px-6 pb-4 shrink-0 border-b border-border/15">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {store!.logo}
                  <button onClick={() => setSelectedStore(null)} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                    Changer
                  </button>
                </div>
                <span className="text-sm font-bold text-foreground">{doneCount}/{items.length} ajoutés</span>
              </div>
              <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {doneCount === items.length && items.length > 0 && (
                <p className="text-xs text-emerald-600 font-semibold mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Tous les articles ont été recherchés — votre panier est prêt !
                </p>
              )}
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {items.map((item, idx) => {
                const done = searched.has(item.name);
                return (
                  <div
                    key={idx}
                    className={`flex items-center justify-between gap-3 p-3 rounded-xl transition-all ${
                      done ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/30" : "bg-muted/20 border border-border/20"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        : <Circle className="w-4 h-4 text-muted-foreground/30 shrink-0" />
                      }
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {item.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{item.quantity} {item.unit}</p>
                      </div>
                    </div>
                    {!done ? (
                      <button
                        onClick={() => openSearch(item.name)}
                        className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold ${store!.text} ${store!.bg} hover:opacity-90 transition-opacity`}
                      >
                        Chercher <ExternalLink className="w-3 h-3" />
                      </button>
                    ) : (
                      <button
                        onClick={() => openSearch(item.name)}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                      >
                        Revoir
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Open store button */}
            <div className="px-6 pb-6 pt-3 shrink-0 border-t border-border/15">
              <a
                href={store!.homeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-2 w-full py-3 rounded-2xl font-bold text-sm ${store!.text} ${store!.bg} hover:opacity-90 transition-opacity`}
              >
                Ouvrir {store!.label} en ligne <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

/* ─── Main shopping page ───────────────────────────────────────────────────── */
export default function ShoppingPage() {
  const { data: list, isLoading: isListLoading } = useGetShoppingList();
  const { coords, error: geoError, isLoading: isGeoLoading, requestLocation } = useGeolocation();
  const [showCartModal, setShowCartModal] = useState(false);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());

  const { data: stores, isLoading: isStoresLoading } = useGetNearbyStores(
    coords || { lat: 0, lng: 0 },
    { query: { enabled: !!coords } }
  );

  const groupedList = list?.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof list>) || {};

  const itemsToBuy = list?.filter(i => !i.inFridge) ?? [];
  const inFridgeItems = list?.filter(i => i.inFridge) ?? [];
  const totalEstimated = itemsToBuy.reduce((s, i) => s + (Number(i.estimatedPrice) || 0), 0);
  const restaurantEquiv = totalEstimated * 3.8;
  const savings = restaurantEquiv - totalEstimated;

  const toggleCheck = (name: string) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const downloadPDF = useCallback(() => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210;
    const marginL = 14;
    const marginR = 14;
    const colW = (pageW - marginL - marginR - 6) / 2;
    let col1Y = 0, col2Y = 0;
    let currentCol = 0;

    // ── Header ──
    doc.setFillColor(37, 145, 74);
    doc.rect(0, 0, pageW, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17);
    doc.setFont("helvetica", "bold");
    doc.text("MonFrigo", marginL, 13);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Moins gaspiller · Mieux manger · Économiser", marginL, 18.5);
    doc.text(new Date().toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" }), pageW - marginR, 13, { align: "right" });

    let y = 32;
    // Summary cards
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(marginL, y, 55, 16, 2, 2, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(22, 101, 52);
    doc.text("TOTAL ESTIMÉ", marginL + 4, y + 5.5);
    doc.setFontSize(13); doc.text(`${totalEstimated.toFixed(2)} $`, marginL + 4, y + 13);
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(marginL + 60, y, 55, 16, 2, 2, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(30, 64, 175);
    doc.text("ARTICLES", marginL + 64, y + 5.5);
    doc.setFontSize(13); doc.text(`${itemsToBuy.length} items`, marginL + 64, y + 13);
    doc.setFillColor(255, 247, 237);
    doc.roundedRect(marginL + 120, y, 70, 16, 2, 2, "F");
    doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(154, 52, 18);
    doc.text("ÉCONOMIES vs RESTAURANTS", marginL + 124, y + 5.5);
    doc.setFontSize(13); doc.text(`~${savings.toFixed(0)} $ / sem.`, marginL + 124, y + 13);
    y += 24;

    doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.3); doc.line(marginL, y, pageW - marginR, y); y += 6;

    const itemsByCategory: Record<string, typeof itemsToBuy> = {};
    for (const item of itemsToBuy) {
      if (!itemsByCategory[item.category]) itemsByCategory[item.category] = [];
      itemsByCategory[item.category].push(item);
    }

    col1Y = y; col2Y = y; currentCol = 0;

    const addPage = () => {
      doc.addPage();
      col1Y = 20; col2Y = 20; currentCol = 0;
      doc.setFillColor(37, 145, 74); doc.rect(0, 0, pageW, 8, "F");
      doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text("MonFrigo — Liste d'épicerie (suite)", marginL, 5.5);
    };

    for (const [category, items] of Object.entries(itemsByCategory)) {
      const catH = 9 + items.length * 7;
      let cY = currentCol === 0 ? col1Y : col2Y;
      const cX = currentCol === 0 ? marginL : marginL + colW + 6;
      if (cY + catH > 278) {
        if (currentCol === 0) { currentCol = 1; cY = col2Y; }
        else { addPage(); cY = col1Y; currentCol = 0; }
      }
      doc.setFillColor(37, 145, 74); doc.roundedRect(cX, cY, colW, 7, 1, 1, "F");
      doc.setFontSize(7); doc.setFont("helvetica", "bold"); doc.setTextColor(255, 255, 255);
      doc.text(category.toUpperCase(), cX + 3, cY + 4.8);
      cY += 9;
      for (const item of items) {
        if (cY > 278) {
          if (currentCol === 0) { currentCol = 1; cY = col2Y; }
          else { addPage(); cY = col1Y; currentCol = 0; }
        }
        const cx = currentCol === 0 ? marginL : marginL + colW + 6;
        doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.35);
        doc.roundedRect(cx, cY - 3, 3.5, 3.5, 0.4, 0.4);
        doc.setFontSize(8.5); doc.setFont("helvetica", "normal"); doc.setTextColor(25, 25, 25);
        doc.text(item.name.length > 22 ? item.name.slice(0, 21) + "…" : item.name, cx + 5, cY);
        doc.setFontSize(6.5); doc.setTextColor(100, 100, 100);
        doc.text(`${item.quantity} ${item.unit}`.slice(0, 20), cx + colW - 1, cY, { align: "right" });
        cY += 7;
      }
      cY += 3;
      if (currentCol === 0) col1Y = cY; else col2Y = cY;
      if (col1Y < col2Y - 20) currentCol = 0;
      else if (col2Y < col1Y - 20) currentCol = 1;
      else currentCol = currentCol === 0 ? 1 : 0;
    }

    const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFillColor(247, 248, 247); doc.rect(0, 284, pageW, 13, "F");
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(140, 140, 140);
      doc.text("Généré par MonFrigo · monfrigo.ca · Moins gaspiller. Mieux manger. Économiser.", marginL, 291);
      doc.text(`Page ${p} / ${pageCount}`, pageW - marginR, 291, { align: "right" });
    }
    doc.save(`liste-epicerie-monfrigo-${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [itemsToBuy, totalEstimated, savings]);

  const checkedCount = checkedItems.size;
  const totalChecked = itemsToBuy.filter(i => checkedItems.has(i.name)).reduce((s, i) => s + (Number(i.estimatedPrice) || 0), 0);

  return (
    <div className="grid lg:grid-cols-12 gap-8 pb-12 pt-4">
      {/* ── LEFT: Shopping List ── */}
      <div className="lg:col-span-7 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 no-print">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Liste d'épicerie</h1>
            {itemsToBuy.length > 0 && (
              <p className="text-sm text-muted-foreground mt-1">
                {itemsToBuy.length} articles · ~{totalEstimated.toFixed(2)} $ estimé
              </p>
            )}
          </div>
          {itemsToBuy.length > 0 && (
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={downloadPDF} className="gap-2">
                <Download className="w-4 h-4" /> PDF
              </Button>
              <Button size="sm" onClick={() => setShowCartModal(true)} className="gap-2">
                <ShoppingCart className="w-4 h-4" /> Commander
              </Button>
            </div>
          )}
        </div>

        {/* Savings banner */}
        {itemsToBuy.length > 0 && (
          <div className="bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-2xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">Vous économisez ~{savings.toFixed(0)} $ cette semaine</p>
              <p className="text-xs text-white/80 mt-0.5">vs commander au restaurant ou en livraison (~{restaurantEquiv.toFixed(0)} $)</p>
            </div>
            <div className="shrink-0 text-right hidden sm:block">
              <p className="text-2xl font-display font-bold">{totalEstimated.toFixed(2)} $</p>
              <p className="text-xs text-white/70">coût semaine</p>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {checkedCount > 0 && (
          <div className="bg-card border border-border/40 rounded-2xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-foreground">{checkedCount} / {itemsToBuy.length} articles cochés</span>
              <span className="text-emerald-600 font-semibold">{totalChecked.toFixed(2)} $ ajoutés</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${(checkedCount / itemsToBuy.length) * 100}%` }} />
            </div>
          </div>
        )}

        {isListLoading ? (
          <div className="space-y-4 animate-pulse">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-2xl" />)}</div>
        ) : Object.keys(groupedList).length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <ShoppingBag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg">Générez d'abord un menu pour voir votre liste d'épicerie ici.</p>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedList).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60 mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border/30" />
                  {category}
                  <span className="h-px flex-1 bg-border/30" />
                </h3>
                <div className="space-y-2">
                  {items.map((item, idx) => {
                    const isChecked = checkedItems.has(item.name);
                    return (
                      <motion.button
                        key={idx}
                        onClick={() => !item.inFridge && toggleCheck(item.name)}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.03 }}
                        className={`w-full flex items-center justify-between p-3.5 rounded-2xl transition-all text-left ${
                          item.inFridge ? "bg-muted/20 opacity-50 cursor-default"
                          : isChecked ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                          : "bg-card border border-border/30 hover:border-border/70 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {item.inFridge || isChecked
                            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                            : <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />
                          }
                          <span className={`font-medium text-sm ${item.inFridge || isChecked ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {item.name}
                          </span>
                          {item.inFridge && (
                            <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-400 shrink-0">
                              Déjà au frigo
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-3">
                          <span className="text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-lg hidden sm:block whitespace-nowrap">
                            {item.quantity} {item.unit}
                          </span>
                          {!item.inFridge && (
                            <span className="text-xs font-semibold text-foreground/70 w-14 text-right whitespace-nowrap">
                              ~{Number(item.estimatedPrice).toFixed(2)} $
                            </span>
                          )}
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: Sidebar ── */}
      <div className="lg:col-span-5 space-y-5 no-print">

        {/* Commander en ligne */}
        {itemsToBuy.length > 0 && (
          <Card className="p-6 border-border/40">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 bg-primary/10 rounded-xl shrink-0">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">Commander en ligne</h2>
                <p className="text-xs text-muted-foreground">Ajoutez chaque article à votre panier épicerie</p>
              </div>
            </div>

            {/* Store logos grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {(Object.keys(STORE_CONFIG) as StoreKey[]).map(key => {
                const s = STORE_CONFIG[key];
                return (
                  <button
                    key={key}
                    onClick={() => setShowCartModal(true)}
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl border-2 border-border/30 hover:border-primary/50 hover:shadow-md transition-all bg-card group"
                  >
                    {s.logo}
                    <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors flex items-center gap-1">
                      Ajouter au panier <ChevronRight className="w-3 h-3" />
                    </span>
                  </button>
                );
              })}
            </div>
            <Button onClick={() => setShowCartModal(true)} className="w-full gap-2" size="sm">
              <ShoppingCart className="w-4 h-4" /> Commencer ma commande
            </Button>
          </Card>
        )}

        {/* Eco / savings card */}
        {itemsToBuy.length > 0 && (
          <Card className="p-6 border-border/40">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl shrink-0">
                <Leaf className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Votre impact cette semaine</h2>
            </div>
            <div className="space-y-0">
              {[
                { label: "Économies vs restaurants", value: `~${savings.toFixed(0)} $`, positive: true },
                { label: "Coût par repas estimé", value: `~${(totalEstimated / 21).toFixed(2)} $`, positive: true },
                { label: "Déjà au frigo (économisé)", value: `${inFridgeItems.length} articles`, positive: true },
                { label: "Total épicerie estimé", value: `${totalEstimated.toFixed(2)} $`, positive: false },
              ].map(stat => (
                <div key={stat.label} className="flex justify-between items-center py-2.5 border-b border-border/15 last:border-0">
                  <span className="text-sm text-muted-foreground">{stat.label}</span>
                  <span className={`text-sm font-bold ${stat.positive ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                    {stat.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Nearby stores */}
        <Card className="p-6 bg-card border-border/40 sticky top-10">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-secondary/10 rounded-xl shrink-0">
              <MapPin className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Épiceries à proximité</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Comparez les prix près de chez vous.</p>
            </div>
          </div>

          {!coords ? (
            <div className="text-center py-4 bg-muted/20 rounded-2xl border border-border/30 px-4">
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                MonFrigo utilise votre position pour trouver les épiceries proches.
                Vos coordonnées ne sont <strong>jamais conservées</strong>.
              </p>
              <Button onClick={requestLocation} disabled={isGeoLoading} className="w-full" size="sm">
                {isGeoLoading ? "Localisation…" : <><Navigation className="w-4 h-4 mr-2" /> Activer la géolocalisation</>}
              </Button>
              {geoError && <p className="text-xs text-destructive mt-3 bg-destructive/10 p-2.5 rounded-xl">{geoError}</p>}
            </div>
          ) : isStoresLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-2xl animate-pulse" />)}</div>
          ) : stores && stores.length > 0 ? (
            <div className="space-y-3">
              {stores.map((store, idx) => (
                <motion.a
                  key={idx}
                  href={store.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.08 }}
                  className={`block p-4 bg-card border rounded-2xl hover:shadow-sm transition-all group relative overflow-hidden ${idx === 0 ? "border-primary/40" : "border-border/40"}`}
                >
                  {idx === 0 && <div className="absolute top-0 inset-x-0 h-0.5 bg-primary" />}
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2.5">
                      <Store className={`w-4 h-4 ${idx === 0 ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <p className="font-bold text-sm text-foreground">{store.name}</p>
                        <p className="text-xs text-muted-foreground">{store.distance} km</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-display font-bold ${idx === 0 ? "text-primary" : "text-foreground"}`}>{store.estimatedTotal} $</p>
                      {store.savings > 0 && <p className="text-xs text-emerald-600 font-semibold">−{store.savings}$</p>}
                    </div>
                  </div>
                </motion.a>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-6">Aucune épicerie trouvée dans votre secteur.</p>
          )}
          <p className="text-[10px] text-muted-foreground/40 text-center mt-4 px-2">Prix indicatifs. Peuvent varier selon les promotions en vigueur.</p>
        </Card>
      </div>

      {/* Guided cart modal */}
      <AnimatePresence>
        {showCartModal && list && (
          <GuidedCartModal list={list} onClose={() => setShowCartModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
