import { useState, useCallback } from "react";

interface GeolocationState {
  coords: { lat: number; lng: number } | null;
  error: string | null;
  isLoading: boolean;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    coords: null,
    error: null,
    isLoading: false,
  });

  const requestLocation = useCallback(() => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    if (!navigator.geolocation) {
      setState({
        coords: null,
        error: "La géolocalisation n'est pas supportée par votre navigateur.",
        isLoading: false,
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          coords: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          error: null,
          isLoading: false,
        });
      },
      (error) => {
        let errorMessage = "Erreur inconnue.";
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Permission refusée. Veuillez autoriser l'accès à votre position.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Information de position indisponible.";
            break;
          case error.TIMEOUT:
            errorMessage = "La demande a expiré.";
            break;
        }
        setState({
          coords: null,
          error: errorMessage,
          isLoading: false,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  }, []);

  return { ...state, requestLocation };
}
