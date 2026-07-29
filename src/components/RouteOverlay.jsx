import { useEffect } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

// Dibuja una ruta real (siguiendo carreteras/aceras) sobre el mapa.
// Se renderiza como hijo de <Map> para tener acceso al mapa vía useMap().
//
// Dos usos:
//   1. Itinerario: `stops` = array ordenado { lat, lng } (inicio → paradas → fin).
//   2. Medida "Desde/Hasta": `origin` + `destination` (+ `mode`), sin paradas intermedias.
//      `preserveViewport` evita que el mapa recentre al medir (el usuario ya está mirando).
export default function RouteOverlay({ stops, origin, destination, mode = 'DRIVING', color = '#256af4', preserveViewport = false }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps) return;

    // Normaliza a origen/destino/paradas según el modo de uso.
    let o, d, waypoints = [];
    if (Array.isArray(stops) && stops.length >= 2) {
      o = stops[0];
      d = stops[stops.length - 1];
      waypoints = stops.slice(1, -1).map(s => ({ location: s, stopover: true }));
    } else if (origin && destination) {
      o = origin;
      d = destination;
    } else {
      return;
    }

    const renderer = new window.google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true, // usamos nuestros propios marcadores
      preserveViewport,
      polylineOptions: { strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85 },
    });

    const ds = new window.google.maps.DirectionsService();
    ds.route(
      { origin: o, destination: d, waypoints, travelMode: mode },
      (res, status) => {
        if (status === 'OK') renderer.setDirections(res);
      }
    );

    return () => renderer.setMap(null);
  }, [map, stops, origin, destination, mode, color, preserveViewport]);

  return null;
}
