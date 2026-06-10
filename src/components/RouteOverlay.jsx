import { useEffect } from 'react';
import { useMap } from '@vis.gl/react-google-maps';

// Dibuja la ruta de un itinerario sobre el mapa siguiendo las carreteras.
// Se renderiza como hijo de <Map> para tener acceso al mapa vía useMap().
// `stops` es un array ordenado de { lat, lng } (inicio → paradas → fin).
export default function RouteOverlay({ stops, color = '#256af4' }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !window.google?.maps || !stops || stops.length < 2) return;

    const renderer = new window.google.maps.DirectionsRenderer({
      map,
      suppressMarkers: true, // usamos nuestros propios marcadores numerados
      preserveViewport: false,
      polylineOptions: { strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85 },
    });

    const ds = new window.google.maps.DirectionsService();
    ds.route(
      {
        origin: stops[0],
        destination: stops[stops.length - 1],
        waypoints: stops.slice(1, -1).map(s => ({ location: s, stopover: true })),
        travelMode: 'DRIVING',
      },
      (res, status) => {
        if (status === 'OK') renderer.setDirections(res);
      }
    );

    return () => renderer.setMap(null);
  }, [map, stops, color]);

  return null;
}
