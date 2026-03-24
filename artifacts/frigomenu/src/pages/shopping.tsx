import { useGetShoppingList, useGetNearbyStores } from "@workspace/api-client-react";
import { Card, Button, Badge } from "@/components/ui-elements";
import { useGeolocation } from "@/hooks/use-geolocation";
import { ShoppingBag, MapPin, Store, Navigation, CheckCircle2, Circle } from "lucide-react";
import { motion } from "framer-motion";

export default function ShoppingPage() {
  const { data: list, isLoading: isListLoading } = useGetShoppingList();
  const { coords, error: geoError, isLoading: isGeoLoading, requestLocation } = useGeolocation();
  
  // Only fetch stores if we have coords
  const { data: stores, isLoading: isStoresLoading } = useGetNearbyStores(
    coords || { lat: 0, lng: 0 }, 
    { query: { enabled: !!coords } }
  );

  // Group shopping list by category
  const groupedList = list?.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof list>) || {};

  return (
    <div className="grid lg:grid-cols-12 gap-10 pb-12 pt-4">
      {/* LEFT COL: Shopping List */}
      <div className="lg:col-span-7 space-y-8">
        <div className="flex items-center gap-4 mb-10 no-print">
          <h1 className="text-4xl font-display font-bold text-foreground">Liste d'épicerie</h1>
        </div>

        {isListLoading ? (
          <div className="space-y-6 animate-pulse">
            <div className="h-8 bg-muted/50 rounded-xl w-1/3"></div>
            <div className="h-24 bg-muted/30 rounded-2xl"></div>
            <div className="h-24 bg-muted/30 rounded-2xl"></div>
          </div>
        ) : Object.keys(groupedList).length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground border-dashed text-lg">
            Générez d'abord un menu pour voir votre liste d'épicerie ici.
          </Card>
        ) : (
          <div className="space-y-10">
            {Object.entries(groupedList).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-xl font-display font-bold mb-4 flex items-center gap-3 text-foreground/90">
                  <span className="w-2.5 h-2.5 rounded-full bg-secondary"></span>
                  {category}
                </h3>
                <div className="space-y-3">
                  {items.map((item, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`flex items-center justify-between p-4 rounded-2xl transition-all ${
                        item.inFridge ? "bg-muted/30 opacity-60" : "bg-card border border-border/40 shadow-sm"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        {item.inFridge ? (
                          <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                        ) : (
                          <Circle className="w-6 h-6 text-muted-foreground/30" />
                        )}
                        <span className={`font-medium text-lg ${item.inFridge ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-semibold bg-muted/50 px-3 py-1.5 rounded-xl text-foreground/80">
                          {item.quantity} {item.unit}
                        </span>
                        {!item.inFridge && (
                          <span className="text-sm text-muted-foreground w-12 text-right">
                            ~{item.estimatedPrice}$
                          </span>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT COL: Stores & Pricing (Hidden in print) */}
      <div className="lg:col-span-5 space-y-6 no-print">
        <Card className="p-8 bg-card border-border/40 sticky top-10">
          <div className="flex items-start gap-4 mb-8">
            <div className="p-3 bg-secondary/10 rounded-2xl">
              <MapPin className="w-6 h-6 text-secondary" />
            </div>
            <div>
              <h2 className="text-2xl font-display font-bold text-foreground">Épiceries à proximité</h2>
              <p className="text-base text-muted-foreground mt-1">Trouvez le meilleur prix pour votre liste.</p>
            </div>
          </div>

          {!coords ? (
            <div className="text-center py-8 bg-muted/20 rounded-3xl border border-border/40">
              <Button onClick={requestLocation} disabled={isGeoLoading} className="w-full" size="lg">
                {isGeoLoading ? "Localisation..." : "Autoriser la géolocalisation"}
              </Button>
              {geoError && <p className="text-sm text-destructive mt-4 font-medium bg-destructive/10 p-3 rounded-xl">{geoError}</p>}
            </div>
          ) : isStoresLoading ? (
            <div className="space-y-4">
              {[1,2,3].map(i => <div key={i} className="h-32 bg-muted/30 rounded-2xl animate-pulse" />)}
            </div>
          ) : stores && stores.length > 0 ? (
            <div className="space-y-5">
              {stores.map((store, idx) => {
                const isBestPrice = idx === 0;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    key={idx}
                  >
                    <a 
                      href={store.googleMapsUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className={`block p-6 bg-card border rounded-3xl hover:shadow-md transition-all group relative overflow-hidden ${
                        isBestPrice ? 'border-primary/40 shadow-sm' : 'border-border/40'
                      }`}
                    >
                      {isBestPrice && (
                        <div className="absolute top-0 inset-x-0 h-1 bg-primary" />
                      )}
                      
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-3">
                          <Store className={`w-6 h-6 ${isBestPrice ? 'text-primary' : 'text-muted-foreground'}`} />
                          <h3 className="font-bold text-lg">{store.name}</h3>
                        </div>
                        <Badge variant="outline" className="bg-background">
                          {store.distance} km
                        </Badge>
                      </div>
                      
                      <div className="flex justify-between items-end mt-6 pt-4 border-t border-border/30">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-bold">Total estimé</p>
                          <p className={`text-3xl font-display font-bold ${isBestPrice ? 'text-primary' : 'text-foreground'}`}>
                            {store.estimatedTotal} $
                          </p>
                        </div>
                        {store.savings > 0 && (
                          <div className="text-right">
                            <p className="text-sm text-emerald-600 font-bold bg-emerald-500/10 px-3 py-1.5 rounded-xl mb-2">
                              Économie: {store.savings}$
                            </p>
                            <div className="flex items-center text-sm font-medium text-primary group-hover:underline justify-end">
                              <Navigation className="w-4 h-4 mr-1.5" /> Y aller
                            </div>
                          </div>
                        )}
                      </div>
                    </a>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-lg py-8">Aucune épicerie trouvée dans votre secteur.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
