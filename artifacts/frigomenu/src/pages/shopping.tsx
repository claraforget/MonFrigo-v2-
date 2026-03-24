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
    <div className="grid lg:grid-cols-12 gap-8 pb-12">
      {/* LEFT COL: Shopping List */}
      <div className="lg:col-span-7 space-y-6">
        <div className="flex items-center gap-3 mb-8 no-print">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShoppingBag className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Liste d'épicerie</h1>
            <p className="text-muted-foreground">Basée sur votre menu de la semaine</p>
          </div>
        </div>

        {isListLoading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-10 bg-muted/50 rounded-lg w-1/3"></div>
            <div className="h-20 bg-muted/30 rounded-xl"></div>
            <div className="h-20 bg-muted/30 rounded-xl"></div>
          </div>
        ) : Object.keys(groupedList).length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground border-dashed">
            Générez d'abord un menu pour voir votre liste d'épicerie ici.
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedList).map(([category, items]) => (
              <div key={category}>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 border-b pb-2">
                  <span className="w-3 h-3 rounded-full bg-secondary"></span>
                  {category}
                </h3>
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`flex items-center justify-between p-3 rounded-xl transition-colors ${
                        item.inFridge ? "bg-muted/30 opacity-60" : "bg-card border shadow-sm hover:shadow-md"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {item.inFridge ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        ) : (
                          <Circle className="w-5 h-5 text-muted-foreground" />
                        )}
                        <span className={`font-medium ${item.inFridge ? "line-through text-muted-foreground" : "text-foreground"}`}>
                          {item.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-semibold bg-muted px-2 py-1 rounded-md">
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
        <Card className="p-6 bg-gradient-to-br from-primary/10 via-background to-secondary/5 border-primary/20 sticky top-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="p-3 bg-white rounded-xl shadow-sm">
              <MapPin className="w-6 h-6 text-secondary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Épiceries à proximité</h2>
              <p className="text-sm text-muted-foreground mt-1">Trouvez le meilleur prix pour votre liste complète.</p>
            </div>
          </div>

          {!coords ? (
            <div className="text-center py-6">
              <Button onClick={requestLocation} disabled={isGeoLoading} className="w-full" size="lg">
                {isGeoLoading ? "Localisation..." : "Autoriser la géolocalisation"}
              </Button>
              {geoError && <p className="text-sm text-destructive mt-3 font-medium bg-destructive/10 p-2 rounded-lg">{geoError}</p>}
            </div>
          ) : isStoresLoading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-24 bg-background rounded-xl animate-pulse" />)}
            </div>
          ) : stores && stores.length > 0 ? (
            <div className="space-y-4">
              {stores.map((store, idx) => (
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
                    className="block p-4 bg-background border border-border rounded-xl hover:border-primary/50 hover:shadow-lg transition-all group"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <Store className="w-5 h-5 text-primary" />
                        <h3 className="font-bold">{store.name}</h3>
                      </div>
                      <Badge variant={idx === 0 ? "success" : "default"}>
                        {store.distance} km
                      </Badge>
                    </div>
                    
                    <div className="flex justify-between items-end mt-4">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Total estimé</p>
                        <p className="text-2xl font-display font-bold text-foreground">{store.estimatedTotal} $</p>
                      </div>
                      {store.savings > 0 && (
                        <div className="text-right">
                          <p className="text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-1 rounded-md mb-1">
                            Économie: {store.savings}$
                          </p>
                          <div className="flex items-center text-xs text-primary group-hover:underline">
                            <Navigation className="w-3 h-3 mr-1" /> Y aller
                          </div>
                        </div>
                      )}
                    </div>
                  </a>
                </motion.div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground">Aucune épicerie trouvée dans votre secteur.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
