// Adaptador para Places API (New) de Google Maps.
//
// Encapsula la API nueva (`google.maps.places.Place` / `AutocompleteSuggestion`)
// y devuelve objetos NORMALIZADOS con la misma forma que ya consume el store y
// los componentes (name, placeId, lat, lng, address, rating, userRatingsTotal,
// photoUrl, photos, openingHours, website, phoneNumber, priceLevel, types).
//
// Motivo: la Places API legacy (PlacesService.textSearch/getDetails/nearbySearch,
// AutocompleteService, photo.getUrl) ya no se habilita en proyectos de Google
// Cloud creados después del 1-marzo-2025. Toda la migración se concentra aquí.

const PLACE_FIELDS = [
  'displayName',
  'id',
  'location',
  'formattedAddress',
  'rating',
  'userRatingCount',
  'photos',
  'regularOpeningHours',
  'websiteURI',
  'nationalPhoneNumber',
  'priceLevel',
  'types',
];

// El enum nuevo de priceLevel es un string; el resto de la app lo usa como número 0-4.
const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

async function getPlacesLib() {
  if (!window.google?.maps?.importLibrary) {
    throw new Error('Google Maps aún no se ha cargado.');
  }
  return window.google.maps.importLibrary('places');
}

function photoUrls(place, max = 6, maxWidth = 800) {
  if (!place.photos || place.photos.length === 0) return [];
  // La API nueva de Places usa { maxWidth, maxHeight } en getURI().
  return place.photos.slice(0, max).map((p) => p.getURI({ maxWidth }));
}

// Convierte un `Place` de la API nueva a la forma que usa el resto de la app.
export function normalizePlace(place) {
  const photos = photoUrls(place);
  return {
    name: place.displayName || '',
    placeId: place.id,
    lat: place.location?.lat() ?? null,
    lng: place.location?.lng() ?? null,
    address: place.formattedAddress || '',
    rating: place.rating ?? null,
    userRatingsTotal: place.userRatingCount ?? null,
    photoUrl: photos[0] || null,
    photos,
    openingHours: place.regularOpeningHours?.weekdayDescriptions || null,
    website: place.websiteURI || null,
    phoneNumber: place.nationalPhoneNumber || null,
    priceLevel: place.priceLevel != null ? (PRICE_LEVEL_MAP[place.priceLevel] ?? null) : null,
    types: place.types || [],
  };
}

// Reemplaza PlacesService.textSearch. Lanza si la API falla (billing/clave/cuota).
export async function searchPlacesByText(query, { locationBias = null, limit = 8 } = {}) {
  const { Place } = await getPlacesLib();
  const request = {
    textQuery: query,
    fields: PLACE_FIELDS,
    language: 'es',
    maxResultCount: limit,
  };
  if (locationBias) {
    request.locationBias = { center: locationBias, radius: 50000 };
  }
  const { places } = await Place.searchByText(request);
  return (places || []).map(normalizePlace);
}

// Reemplaza PlacesService.nearbySearch (restaurante mejor valorado cercano).
export async function searchNearbyRestaurant(center, radius = 1000) {
  const { Place, SearchNearbyRankPreference } = await getPlacesLib();
  const { places } = await Place.searchNearby({
    fields: ['displayName', 'location', 'rating', 'formattedAddress'],
    locationRestriction: { center, radius },
    includedPrimaryTypes: ['restaurant'],
    rankPreference: SearchNearbyRankPreference.POPULARITY,
    maxResultCount: 10,
    language: 'es',
  });
  if (!places || places.length === 0) return null;
  const best = [...places].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
  return {
    name: best.displayName || '',
    rating: best.rating ?? null,
    vicinity: best.formattedAddress || '',
    lat: best.location?.lat() ?? null,
    lng: best.location?.lng() ?? null,
  };
}

// Reemplaza PlacesService.getDetails.
export async function getPlaceDetails(placeId) {
  const { Place } = await getPlacesLib();
  const place = new Place({ id: placeId });
  await place.fetchFields({ fields: PLACE_FIELDS });
  return normalizePlace(place);
}

// Reemplaza AutocompleteService.getPlacePredictions (sugerencias de destino/región).
// Devuelve [{ placeId, description }].
export async function getDestinationSuggestions(input) {
  if (!input || input.length < 2) return [];
  const { AutocompleteSuggestion } = await getPlacesLib();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input,
    includedPrimaryTypes: ['(regions)'],
    language: 'es',
  });
  return (suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      placeId: p.placeId,
      description: p.text?.text || '',
    }));
}
