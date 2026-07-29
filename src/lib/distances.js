// Cálculo de distancias y tiempos entre el alojamiento (origen dinámico) y los lugares.
//
// Filosofía (acordada con el usuario): BAJO DEMANDA para minimizar llamadas de pago.
//   - Al fijar el campamento base se recalcula SOLO la matriz de COCHE en lote (barato:
//     Distance Matrix agrupa muchos destinos por petición).
//   - Andando / transporte público se calculan de forma perezosa al abrir el detalle de un
//     lugar, y se cachean en el registro `distances` del viaje por (accId, poiId).
//
// Toda la información DESCRIPTIVA del lugar es independiente del alojamiento; aquí solo
// vive lo que sí depende del origen: distancia, tiempos por modo y (opcional) la ruta.

const MODE_KEY = {
  DRIVING: 'drivingDurationSeconds',
  WALKING: 'walkingDurationSeconds',
  TRANSIT: 'transitDurationSeconds',
  BICYCLING: 'bicyclingDurationSeconds',
};

export function modeDurationKey(mode) {
  return MODE_KEY[mode] || 'drivingDurationSeconds';
}

function ensureMaps() {
  if (!window.google?.maps) throw new Error('Google Maps aún no se ha cargado.');
}

// Matriz de tiempos EN COCHE de una base a muchos lugares. Reutiliza el troceado
// 25 orígenes / 25 destinos / 100 elementos que exige Distance Matrix API.
// Devuelve [{ poiId, drivingDurationSeconds, distanceMeters }] (solo los que resuelven).
export async function computeDrivingMatrix(base, pois) {
  ensureMaps();
  const valid = (pois || []).filter((p) => p && p.lat != null && p.lng != null);
  if (!base || base.lat == null || valid.length === 0) return [];

  const service = new window.google.maps.DistanceMatrixService();
  const origins = [new window.google.maps.LatLng(base.lat, base.lng)];
  const destinations = valid.map((p) => new window.google.maps.LatLng(p.lat, p.lng));

  const MAX_DIM = 25, MAX_ELEMS = 100;
  const destPerReq = Math.max(1, Math.min(MAX_DIM, Math.floor(MAX_ELEMS / origins.length)));
  const out = [];

  for (let di = 0; di < destinations.length; di += destPerReq) {
    const dChunk = destinations.slice(di, di + destPerReq);
    const response = await new Promise((resolve, reject) => {
      service.getDistanceMatrix(
        { origins, destinations: dChunk, travelMode: 'DRIVING', language: 'es' },
        (res, status) => (status === 'OK' ? resolve(res) : reject(new Error(status)))
      );
    });
    (response.rows[0]?.elements || []).forEach((el, c) => {
      if (el && el.status === 'OK') {
        out.push({
          poiId: valid[di + c].id,
          drivingDurationSeconds: el.duration.value,
          distanceMeters: el.distance.value,
        });
      }
    });
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}

// Tiempo/distancia de la base a UN lugar en un modo concreto (para andando/TP bajo demanda).
// Devuelve { durationSec, distanceMeters } o null si no hay ruta en ese modo.
export async function computeTravel(base, poi, mode = 'WALKING') {
  ensureMaps();
  if (!base || base.lat == null || !poi || poi.lat == null) return null;
  const ds = new window.google.maps.DirectionsService();
  try {
    const res = await new Promise((resolve) => {
      ds.route(
        {
          origin: { lat: base.lat, lng: base.lng },
          destination: { lat: poi.lat, lng: poi.lng },
          travelMode: mode,
        },
        (r, status) => resolve(status === 'OK' ? r : null)
      );
    });
    const leg = res?.routes?.[0]?.legs?.[0];
    if (!leg) return null;
    return { durationSec: leg.duration.value, distanceMeters: leg.distance.value };
  } catch {
    return null;
  }
}

// Busca el registro de distancia guardado para (base, poi) en el viaje.
export function findDistance(trip, accId, poiId) {
  if (!trip || !accId) return null;
  return (trip.distances || []).find((d) => d.accommodationId === accId && d.poiId === poiId) || null;
}
