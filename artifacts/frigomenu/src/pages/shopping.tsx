import { useGetShoppingList, useGetNearbyStores } from "@workspace/api-client-react";
import { Card, Button, Badge } from "@/components/ui-elements";
import { useGeolocation } from "@/hooks/use-geolocation";
import {
  ShoppingBag, MapPin, Store, Navigation, CheckCircle2, Circle, Download,
  ShoppingCart, Copy, Check, TrendingDown, Leaf, ExternalLink, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import jsPDF from "jspdf";
import { useState, useCallback } from "react";

const STORES = [
  { name: "IGA", color: "#e30613", logo: "🛒", url: "https://www.iga.net/fr/epicerie-en-ligne", tagline: "Produits locaux · Marque PC" },
  { name: "Metro", color: "#003da5", logo: "🛒", url: "https://www.metro.ca/epicerie-en-ligne", tagline: "Flyers hebdomadaires · Fidélisation" },
  { name: "Maxi", color: "#ffcc00", textColor: "#000", logo: "🛒", url: "https://www.maxi.ca", tagline: "Prix bas garantis · No Name" },
  { name: "Walmart", color: "#0071ce", logo: "🛒", url: "https://www.walmart.ca/fr/epicerie", tagline: "Prix imbattables · Livraison rapide" },
];

function OnlineOrderModal({ list, onClose }: {
  list: Array<{ name: string; quantity: string; unit: string; category: string; inFridge: boolean; estimatedPrice: number }>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [selectedStore, setSelectedStore] = useState<typeof STORES[0] | null>(null);
  const itemsToBuy = list.filter(i => !i.inFridge);

  const formattedList = itemsToBuy
    .map(i => `☐ ${i.name} — ${i.quantity} ${i.unit}`)
    .join("\n");

  const copyList = useCallback(async () => {
    await navigator.clipboard.writeText(formattedList);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formattedList]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18 }}
        className="bg-card rounded-3xl shadow-2xl border border-border/50 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border/20 shrink-0">
          <div>
            <h2 className="text-xl font-bold text-foreground">Commander en ligne</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{itemsToBuy.length} articles à acheter</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted/50 text-muted-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1 — Copy list */}
        <div className="px-6 py-5 border-b border-border/10 shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <p className="text-sm font-semibold text-foreground">Copiez votre liste</p>
          </div>
          <div className="bg-muted/30 rounded-2xl p-3 max-h-40 overflow-y-auto mb-3">
            <pre className="text-xs text-foreground/70 whitespace-pre-wrap font-mono leading-relaxed">{formattedList}</pre>
          </div>
          <Button onClick={copyList} variant={copied ? "default" : "outline"} size="sm" className="w-full gap-2">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Liste copiée !" : "Copier la liste complète"}
          </Button>
        </div>

        {/* Step 2 — Choose store */}
        <div className="px-6 py-5 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">2</span>
            <p className="text-sm font-semibold text-foreground">Choisissez votre épicerie en ligne</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {STORES.map(store => (
              <a
                key={store.name}
                href={store.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-border/40 hover:border-primary/40 hover:shadow-sm transition-all bg-card group"
              >
                <span className="text-2xl font-black" style={{ color: store.color, textShadow: "none" }}>{store.name}</span>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">{store.tagline}</span>
                <span className="flex items-center gap-1 text-[10px] text-primary font-medium group-hover:underline">
                  Ouvrir <ExternalLink className="w-3 h-3" />
                </span>
              </a>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/60 text-center mt-5 leading-relaxed px-2">
            Ouvrez l'épicerie de votre choix, naviguez vers l'épicerie en ligne et collez votre liste dans la barre de recherche pour ajouter les articles un par un à votre panier.
          </p>
        </div>
      </motion.div>
    </div>
  );
}

export default function ShoppingPage() {
  const { data: list, isLoading: isListLoading } = useGetShoppingList();
  const { coords, error: geoError, isLoading: isGeoLoading, requestLocation } = useGeolocation();
  const [showOrderModal, setShowOrderModal] = useState(false);
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

  const downloadPDF = () => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210;
    const marginL = 14;
    const marginR = 14;
    const colW = (pageW - marginL - marginR - 6) / 2;
    let y = 0;

    // ── Header band ──────────────────────────────────────────────────────────
    doc.setFillColor(37, 145, 74); // brand green
    doc.rect(0, 0, pageW, 22, "F");

    // Logo area
    doc.setFillColor(255, 255, 255, 0.15);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(17);
    doc.setFont("helvetica", "bold");
    doc.text("MonFrigo", marginL, 13);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text("Moins gaspiller · Mieux manger · Économiser", marginL, 18.5);

    // Date top right
    doc.setFontSize(8);
    doc.text(
      new Date().toLocaleDateString("fr-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
      pageW - marginR, 13, { align: "right" }
    );

    y = 32;

    // ── Summary cards ─────────────────────────────────────────────────────────
    // Total card
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(marginL, y, 55, 16, 2, 2, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 101, 52);
    doc.text("TOTAL ESTIMÉ", marginL + 4, y + 5.5);
    doc.setFontSize(14);
    doc.text(`${totalEstimated.toFixed(2)} $`, marginL + 4, y + 13);

    // Articles count card
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(marginL + 60, y, 55, 16, 2, 2, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 64, 175);
    doc.text("ARTICLES", marginL + 64, y + 5.5);
    doc.setFontSize(14);
    doc.text(`${itemsToBuy.length} items`, marginL + 64, y + 13);

    // Savings card
    doc.setFillColor(255, 247, 237);
    doc.roundedRect(marginL + 120, y, 70, 16, 2, 2, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(154, 52, 18);
    doc.text("ÉCONOMIES vs RESTAURANTS", marginL + 124, y + 5.5);
    doc.setFontSize(14);
    doc.text(`~${savings.toFixed(0)} $ / sem.`, marginL + 124, y + 13);

    y += 24;

    // ── Divider ───────────────────────────────────────────────────────────────
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(marginL, y, pageW - marginR, y);
    y += 6;

    // ── Two-column body ───────────────────────────────────────────────────────
    const col1X = marginL;
    const col2X = marginL + colW + 6;
    let col1Y = y;
    let col2Y = y;
    let currentCol = 0; // 0 = left, 1 = right

    const itemsByCategory: Record<string, typeof itemsToBuy> = {};
    for (const item of itemsToBuy) {
      if (!itemsByCategory[item.category]) itemsByCategory[item.category] = [];
      itemsByCategory[item.category].push(item);
    }

    const addPage = () => {
      doc.addPage();
      col1Y = 20; col2Y = 20; currentCol = 0;
      // Subtle header
      doc.setFillColor(37, 145, 74);
      doc.rect(0, 0, pageW, 8, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text("MonFrigo — Liste d'épicerie (suite)", marginL, 5.5);
    };

    for (const [category, items] of Object.entries(itemsByCategory)) {
      const catHeight = 8 + items.length * 7;
      const colX = currentCol === 0 ? col1X : col2X;
      let colY = currentCol === 0 ? col1Y : col2Y;

      // Check if category fits in current column
      if (colY + catHeight > 278) {
        if (currentCol === 0) {
          currentCol = 1;
          colY = col2Y;
        } else {
          addPage();
          currentCol = 0;
          colY = col1Y;
        }
      }

      const cX = currentCol === 0 ? col1X : col2X;

      // Category header
      doc.setFillColor(37, 145, 74);
      doc.roundedRect(cX, colY, colW, 7, 1, 1, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(255, 255, 255);
      doc.text(category.toUpperCase(), cX + 3, colY + 4.8);
      colY += 9;

      for (const item of items) {
        if (colY > 278) {
          if (currentCol === 0) { currentCol = 1; colY = col2Y; }
          else { addPage(); currentCol = 0; colY = col1Y; }
        }
        const cx = currentCol === 0 ? col1X : col2X;
        // Checkbox
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.35);
        doc.roundedRect(cx, colY - 3, 3.5, 3.5, 0.4, 0.4);
        // Item name
        doc.setFontSize(8.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(25, 25, 25);
        const nameStr = item.name.length > 22 ? item.name.slice(0, 21) + "…" : item.name;
        doc.text(nameStr, cx + 5, colY);
        // Qty pill
        const qtyStr = `${item.quantity} ${item.unit}`.slice(0, 20);
        doc.setFontSize(6.5);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(qtyStr, cx + colW - 1, colY, { align: "right" });
        colY += 7;
      }
      colY += 3;

      if (currentCol === 0) col1Y = colY;
      else col2Y = colY;

      // Alternate columns for next category
      if (col1Y < col2Y - 20) currentCol = 0;
      else if (col2Y < col1Y - 20) currentCol = 1;
      else currentCol = currentCol === 0 ? 1 : 0;
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFillColor(247, 248, 247);
      doc.rect(0, 284, pageW, 13, "F");
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(140, 140, 140);
      doc.text("Généré par MonFrigo · monfrigo.ca · Moins gaspiller. Mieux manger. Économiser.", marginL, 291);
      doc.text(`Page ${p} / ${pageCount}`, pageW - marginR, 291, { align: "right" });
    }

    doc.save(`liste-epicerie-monfrigo-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const checkedCount = checkedItems.size;
  const totalChecked = itemsToBuy.filter(i => checkedItems.has(i.name)).reduce((s, i) => s + (Number(i.estimatedPrice) || 0), 0);

  return (
    <div className="grid lg:grid-cols-12 gap-8 pb-12 pt-4">
      {/* ── LEFT: Shopping List ───────────────────────────────────────────── */}
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
              <Button size="sm" onClick={() => setShowOrderModal(true)} className="gap-2">
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
              <p className="text-xs text-white/80 mt-0.5">vs commander au restaurant ou livraison pour {restaurantEquiv.toFixed(0)} $</p>
            </div>
            <div className="shrink-0 text-right hidden sm:block">
              <p className="text-2xl font-display font-bold">{totalEstimated.toFixed(2)} $</p>
              <p className="text-xs text-white/70">coût semaine</p>
            </div>
          </div>
        )}

        {/* Progress bar if some items checked */}
        {checkedCount > 0 && (
          <div className="bg-card border border-border/40 rounded-2xl p-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-foreground">{checkedCount} / {itemsToBuy.length} articles dans le panier</span>
              <span className="text-emerald-600 font-semibold">{totalChecked.toFixed(2)} $ ajoutés</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${(checkedCount / itemsToBuy.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {isListLoading ? (
          <div className="space-y-4 animate-pulse">
            {[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-2xl" />)}
          </div>
        ) : Object.keys(groupedList).length === 0 ? (
          <Card className="p-12 text-center border-dashed">
            <ShoppingBag className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg">Générez d'abord un menu pour voir votre liste d'épicerie ici.</p>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedList).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/70 mb-3 flex items-center gap-2">
                  <span className="h-px flex-1 bg-border/40" />
                  {category}
                  <span className="h-px flex-1 bg-border/40" />
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
                          item.inFridge
                            ? "bg-muted/20 opacity-50 cursor-default"
                            : isChecked
                            ? "bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                            : "bg-card border border-border/30 hover:border-border/70 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {item.inFridge ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                          ) : isChecked ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                          ) : (
                            <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />
                          )}
                          <span className={`font-medium text-sm ${item.inFridge || isChecked ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {item.name}
                          </span>
                          {item.inFridge && (
                            <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-400 shrink-0">
                              Dans le frigo
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

      {/* ── RIGHT: Store finder + eco ─────────────────────────────────────── */}
      <div className="lg:col-span-5 space-y-5 no-print">

        {/* Commander en ligne card */}
        {itemsToBuy.length > 0 && (
          <Card className="p-6 border-border/40">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 bg-primary/10 rounded-xl">
                <ShoppingCart className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">Commander en ligne</h2>
                <p className="text-xs text-muted-foreground">Livraison ou cueillette — à vous de choisir</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              {STORES.map(store => (
                <button
                  key={store.name}
                  onClick={() => setShowOrderModal(true)}
                  className="flex flex-col items-center gap-1.5 p-3.5 rounded-2xl border border-border/40 hover:border-primary/40 hover:shadow-sm transition-all bg-card"
                >
                  <span className="text-xl font-black leading-none" style={{ color: store.color }}>{store.name}</span>
                  <span className="text-[10px] text-muted-foreground text-center">{store.tagline}</span>
                </button>
              ))}
            </div>
            <Button onClick={() => setShowOrderModal(true)} className="w-full gap-2" size="sm">
              <ShoppingCart className="w-4 h-4" /> Préparer ma commande
            </Button>
          </Card>
        )}

        {/* Eco / savings card */}
        {itemsToBuy.length > 0 && (
          <Card className="p-6 border-border/40">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl">
                <Leaf className="w-5 h-5 text-emerald-600" />
              </div>
              <h2 className="text-lg font-bold text-foreground">Votre impact cette semaine</h2>
            </div>
            <div className="space-y-3">
              {[
                { label: "Économies vs restaurants", value: `~${savings.toFixed(0)} $`, positive: true },
                { label: "Coût par repas estimé", value: `~${(totalEstimated / 21).toFixed(2)} $`, positive: true },
                { label: "Articles déjà au frigo", value: `${(list?.filter(i => i.inFridge) ?? []).length} items`, positive: true },
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
            <div className="p-2.5 bg-secondary/10 rounded-xl">
              <MapPin className="w-5 h-5 text-secondary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Épiceries à proximité</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Trouvez le meilleur prix pour votre liste.</p>
            </div>
          </div>

          {!coords ? (
            <div className="text-center py-4 bg-muted/20 rounded-2xl border border-border/30 px-4">
              <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
                MonFrigo utilise votre position pour trouver les épiceries proches et comparer les prix.
                Vos coordonnées ne sont <strong>jamais conservées</strong>.
              </p>
              <Button onClick={requestLocation} disabled={isGeoLoading} className="w-full" size="sm">
                {isGeoLoading ? "Localisation en cours…" : <><Navigation className="w-4 h-4 mr-2" /> Activer la géolocalisation</>}
              </Button>
              {geoError && <p className="text-xs text-destructive mt-3 bg-destructive/10 p-2.5 rounded-xl">{geoError}</p>}
            </div>
          ) : isStoresLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-24 bg-muted/30 rounded-2xl animate-pulse" />)}
            </div>
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
                  className={`block p-4 bg-card border rounded-2xl hover:shadow-sm transition-all group relative overflow-hidden ${
                    idx === 0 ? "border-primary/40" : "border-border/40"
                  }`}
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
                      <p className={`text-xl font-display font-bold ${idx === 0 ? "text-primary" : "text-foreground"}`}>
                        {store.estimatedTotal} $
                      </p>
                      {store.savings > 0 && (
                        <p className="text-xs text-emerald-600 font-semibold">−{store.savings}$</p>
                      )}
                    </div>
                  </div>
                </motion.a>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-6">Aucune épicerie trouvée dans votre secteur.</p>
          )}
          <p className="text-[10px] text-muted-foreground/40 text-center mt-4 px-2">
            Prix indicatifs. Peuvent varier selon les promotions en vigueur.
          </p>
        </Card>
      </div>

      {/* Online order modal */}
      <AnimatePresence>
        {showOrderModal && list && (
          <OnlineOrderModal list={list} onClose={() => setShowOrderModal(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
