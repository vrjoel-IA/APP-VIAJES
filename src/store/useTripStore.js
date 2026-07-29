import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';
import { saveCache, loadCache } from '../lib/tripCache';
import { haversineMeters, namesSimilar } from '../lib/tripSchema';
import { guessCategory, shouldAutoClassify } from '../lib/categorize';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Rellena un POI con los campos nuevos del contrato si le faltan (migración idempotente).
// Los datos antiguos, introducidos a mano, se marcan `fuente: 'manual'` sin perder nada.
function normalizePoi(p) {
  // Reclasificación automática (idempotente): si el lugar cae en 'other'/'culture' o no
  // tiene categoría y el usuario no la ha fijado a mano, intentamos algo más específico.
  // Nunca degradamos 'culture' -> 'other': solo mejoramos.
  let category = p.category || 'other';
  if (shouldAutoClassify(p)) {
    const guess = guessCategory({ name: p.name, types: p.types, notas: p.notas });
    if (guess !== 'other') category = guess;
  }
  return {
    ...p,
    category,
    municipio: p.municipio || '',
    imprescindible: !!p.imprescindible,
    yaVisitado: !!p.yaVisitado,
    descartado: !!p.descartado,
    duracionEstimadaMin: typeof p.duracionEstimadaMin === 'number' ? p.duracionEstimadaMin : null,
    mejorMomento: p.mejorMomento || '',
    notas: p.notas || '',
    fuente: p.fuente || 'manual',
  };
}

// Da a un viaje cargado la forma completa del nuevo esquema, sin perder nada de lo antiguo.
function migrateTrip(t) {
  return {
    ...t,
    pois: (t.pois || []).map(normalizePoi),
    accommodations: t.accommodations || [],
    eventos: t.eventos || [],
    gastronomia: t.gastronomia || [],
    logistica: t.logistica && typeof t.logistica === 'object' ? t.logistica : {},
    seccionesGuia: t.seccionesGuia || [],
    itineraries: t.itineraries || [],
  };
}

// Aplica un mapa de reasignación de ids a una referencia (o null si no hay).
function remapRef(ref, remap) {
  if (!ref) return ref;
  return remap[ref] || ref;
}

export function useTripStore() {
  const [data, setData] = useState({ trips: [], activeTrip: null, loading: true });
  const { user } = useAuthStore();

  const loadTrips = useCallback(async () => {
    if (!user) {
      setData({ trips: [], activeTrip: null, loading: false });
      return;
    }

    // Hidratar al instante desde la caché offline mientras Supabase responde.
    const cached = loadCache(user.id);
    if (cached) {
      setData(prev => ({ ...prev, trips: cached.map(migrateTrip), loading: prev.trips.length === 0 ? true : false }));
    } else {
      setData(prev => ({ ...prev, loading: true }));
    }

    try {
      // RLS en Supabase filtra las filas que el usuario puede ver (propias o compartidas).
      const { data: dbTrips, error } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const safeParse = (val) => {
        if (!val) return [];
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch { return []; }
        }
        return Array.isArray(val) ? val : [];
      };
      const safeParseObj = (val) => {
        if (!val) return {};
        if (typeof val === 'string') {
          try { const o = JSON.parse(val); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
        }
        return typeof val === 'object' && !Array.isArray(val) ? val : {};
      };

      const parsedTrips = (dbTrips || []).map(t => migrateTrip({
        id: t.id,
        userId: t.user_id,
        name: t.name,
        destination: t.destination,
        destinationLat: t.destination_lat,
        destinationLng: t.destination_lng,
        startDate: t.start_date,
        endDate: t.end_date,
        pois: safeParse(t.pois),
        accommodations: safeParse(t.accommodations),
        distances: safeParse(t.distances),
        selectedAccommodation: t.selected_accommodation,
        sharedWith: safeParse(t.shared_with),
        eventos: safeParse(t.eventos),
        gastronomia: safeParse(t.gastronomia),
        logistica: safeParseObj(t.logistica),
        seccionesGuia: safeParse(t.secciones_guia),
        itineraries: safeParse(t.itinerarios),
        createdAt: t.created_at,
      }));

      saveCache(user.id, parsedTrips);
      setData(prev => ({ ...prev, trips: parsedTrips, loading: false }));
    } catch (error) {
      console.error('Error loading trips:', error);
      // Sin conexión: si hay caché, seguimos con ella; si no, dejamos de cargar igualmente.
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [user]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const saveTripsToDb = async (tripsToSave) => {
    if (!user) return;
    // Columnas base (siempre existen) y columnas nuevas (requieren la migración
    // supabase/migrations/20260729_add_trip_store_columns.sql).
    const baseRow = (t) => ({
      id: t.id,
      user_id: t.userId || user.id,
      name: t.name,
      destination: t.destination,
      destination_lat: t.destinationLat,
      destination_lng: t.destinationLng,
      start_date: t.startDate,
      end_date: t.endDate,
      pois: t.pois,
      accommodations: t.accommodations,
      distances: t.distances,
      selected_accommodation: t.selectedAccommodation,
      shared_with: t.sharedWith || [],
    });
    const fullRow = (t) => ({
      ...baseRow(t),
      eventos: t.eventos || [],
      gastronomia: t.gastronomia || [],
      logistica: t.logistica || {},
      secciones_guia: t.seccionesGuia || [],
      itinerarios: t.itineraries || [],
    });

    // ¿El error viene de que aún no existen las columnas nuevas? (migración pendiente)
    const isMissingColumn = (error) => {
      const msg = `${error?.message || ''} ${error?.details || ''}`.toLowerCase();
      return error?.code === '42703' || error?.code === 'PGRST204' ||
        ['eventos', 'gastronomia', 'logistica', 'secciones_guia', 'itinerarios']
          .some(c => msg.includes(c) && msg.includes('column'));
    };

    try {
      const { error } = await supabase.from('trips').upsert(tripsToSave.map(fullRow));
      if (error) throw error;
    } catch (error) {
      if (isMissingColumn(error)) {
        // Migración pendiente: guardamos solo las columnas base para no perder datos.
        // Los campos nuevos siguen en la caché local y en el jsonb `pois`.
        console.warn('Columnas nuevas de trips no encontradas: aplica la migración de Supabase. Guardando solo columnas base.');
        try {
          const { error: e2 } = await supabase.from('trips').upsert(tripsToSave.map(baseRow));
          if (e2) throw e2;
        } catch (e2) {
          console.error('Error saving trip to Supabase:', e2);
        }
      } else {
        console.error('Error saving trip to Supabase:', error);
      }
    }
  };

  // Guarda un trip actualizado en estado + Supabase + caché, en un solo sitio.
  const persistTrip = (newTrips, updatedTrip) => {
    if (updatedTrip) saveTripsToDb([updatedTrip]);
    if (user) saveCache(user.id, newTrips);
  };

  // ---- TRIPS ----
  const createTrip = useCallback(async (trip) => {
    const newTrip = {
      id: generateId(),
      userId: user?.id,
      name: trip.name || 'Mi Viaje',
      destination: trip.destination || '',
      destinationLat: trip.destinationLat || null,
      destinationLng: trip.destinationLng || null,
      startDate: trip.startDate || null,
      endDate: trip.endDate || null,
      pois: [],
      accommodations: [],
      distances: [],
      selectedAccommodation: null,
      sharedWith: [],
      eventos: [],
      gastronomia: [],
      logistica: {},
      seccionesGuia: [],
      itineraries: [],
      createdAt: new Date().toISOString(),
    };

    await saveTripsToDb([newTrip]);

    setData(prev => {
      const newTrips = [...prev.trips, newTrip];
      if (user) saveCache(user.id, newTrips);
      return { ...prev, trips: newTrips, activeTrip: newTrip.id };
    });
    return newTrip.id;
  }, [user]);

  const deleteTrip = useCallback(async (tripId) => {
    setData(prev => {
      const newTrips = prev.trips.filter(t => t.id !== tripId);
      if (user) saveCache(user.id, newTrips);
      return {
        ...prev,
        trips: newTrips,
        activeTrip: prev.activeTrip === tripId ? null : prev.activeTrip,
      };
    });
    if (user) {
      await supabase.from('trips').delete().eq('id', tripId).eq('user_id', user.id);
    }
  }, [user]);

  const setActiveTrip = useCallback((tripId) => {
    setData(prev => ({ ...prev, activeTrip: tripId }));
  }, []);

  const getActiveTrip = useCallback(() => {
    return data.trips.find(t => t.id === data.activeTrip) || null;
  }, [data]);

  const updateTrip = useCallback((tripId, updates) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, ...updates } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- IMPORTAR investigación (JSON del contrato ya convertido a interno) ----
  // internal: salida de importToInternal(). mode: 'merge' | 'replace'.
  // dedupe (solo merge): 'skip' omite lugares/bases duplicados por cercanía (<200m) y
  // nombre similar; 'both' los añade todos.
  const importTripData = useCallback((tripId, internal, { mode = 'merge', dedupe = 'skip' } = {}) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => {
        if (t.id !== tripId) return t;

        if (mode === 'replace') {
          return {
            ...t,
            destination: internal.meta?.destino || t.destination,
            startDate: internal.meta?.startDate || t.startDate,
            endDate: internal.meta?.endDate || t.endDate,
            pois: internal.pois,
            accommodations: internal.accommodations,
            selectedAccommodation: internal.selectedAccommodation || null,
            eventos: internal.eventos,
            gastronomia: internal.gastronomia,
            logistica: internal.logistica || {},
            seccionesGuia: internal.seccionesGuia,
            itineraries: internal.itineraries,
            distances: [],
          };
        }

        // ----- MERGE con dedupe -----
        const remap = {};
        const DEDUPE_M = 200;

        const mergedPois = [...t.pois];
        internal.pois.forEach(np => {
          const dup = dedupe === 'skip' && t.pois.find(ep =>
            haversineMeters(ep, np) < DEDUPE_M && namesSimilar(ep.name, np.name));
          if (dup) { remap[np.id] = dup.id; }
          else { mergedPois.push(np); }
        });

        const mergedAccs = [...t.accommodations];
        internal.accommodations.forEach(na => {
          const dup = dedupe === 'skip' && t.accommodations.find(ea =>
            haversineMeters(ea, na) < DEDUPE_M && namesSimilar(ea.name, na.name));
          if (dup) { remap[na.id] = dup.id; }
          else { mergedAccs.push(na); }
        });

        // Reescribe referencias de lo importado a los ids finales (por si hubo dedupe).
        const eventos = internal.eventos.map(e => ({ ...e, lugarId: remapRef(e.lugarId, remap) }));
        const secciones = internal.seccionesGuia.map(s => ({
          ...s,
          lugaresRelacionados: (s.lugaresRelacionados || []).map(id => remapRef(id, remap)),
        }));
        const itineraries = internal.itineraries.map(it => ({
          ...it,
          baseId: remapRef(it.baseId, remap),
          paradas: (it.paradas || []).map(id => remapRef(id, remap)),
        }));

        // Fusiona logística concatenando sus listas.
        const mergeList = (a, b) => [...(a || []), ...(b || [])];
        const logistica = {
          ...t.logistica,
          transporte: mergeList(t.logistica?.transporte, internal.logistica?.transporte),
          apps: mergeList(t.logistica?.apps, internal.logistica?.apps),
          avisos: mergeList(t.logistica?.avisos, internal.logistica?.avisos),
        };

        return {
          ...t,
          destination: t.destination || internal.meta?.destino || '',
          startDate: t.startDate || internal.meta?.startDate || null,
          endDate: t.endDate || internal.meta?.endDate || null,
          pois: mergedPois,
          accommodations: mergedAccs,
          selectedAccommodation: t.selectedAccommodation || internal.selectedAccommodation || null,
          eventos: [...(t.eventos || []), ...eventos],
          gastronomia: [...(t.gastronomia || []), ...internal.gastronomia],
          logistica,
          seccionesGuia: [...(t.seccionesGuia || []), ...secciones],
          itineraries: [...(t.itineraries || []), ...itineraries],
        };
      });

      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- COLLABORATION ----
  const shareTrip = useCallback((tripId, email) => {
    setData(prev => {
      const emailLower = email.toLowerCase().trim();
      const newTrips = prev.trips.map(t => {
        if (t.id !== tripId) return t;
        if ((t.sharedWith || []).includes(emailLower)) return t;
        return { ...t, sharedWith: [...(t.sharedWith || []), emailLower] };
      });
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const removeCollaborator = useCallback((tripId, email) => {
    setData(prev => {
      const emailLower = email.toLowerCase().trim();
      const newTrips = prev.trips.map(t => {
        if (t.id !== tripId) return t;
        return { ...t, sharedWith: (t.sharedWith || []).filter(e => e !== emailLower) };
      });
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- POIs ----
  const addPoi = useCallback((tripId, poi) => {
    const newPoi = {
      id: generateId(),
      name: poi.name,
      placeId: poi.placeId || null,
      category: poi.category || 'other',
      categoryLocked: !!poi.categoryLocked,
      lat: poi.lat,
      lng: poi.lng,
      address: poi.address || '',
      municipio: poi.municipio || '',
      rating: poi.rating || null,
      userRatingsTotal: poi.userRatingsTotal || null,
      photoUrl: poi.photoUrl || null,
      photos: poi.photos || [],
      visitFrequency: poi.visitFrequency || 1,
      openingHours: poi.openingHours || null,
      // Información útil de Google que conviene conservar (teléfono, web, reservas...):
      website: poi.website || null,
      phoneNumber: poi.phoneNumber || null,
      priceLevel: poi.priceLevel ?? null,
      types: poi.types || [],
      reservas: poi.reservas || null,
      reservaUrl: poi.reservaUrl || null,
      requiereCita: poi.requiereCita ?? null,
      // Campos del contrato (opcionales, con default):
      imprescindible: !!poi.imprescindible,
      yaVisitado: !!poi.yaVisitado,
      descartado: !!poi.descartado,
      duracionEstimadaMin: typeof poi.duracionEstimadaMin === 'number' ? poi.duracionEstimadaMin : null,
      mejorMomento: poi.mejorMomento || '',
      notas: poi.notas || '',
      fuente: poi.fuente || 'manual',
      addedAt: new Date().toISOString(),
    };
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, pois: [...t.pois, newPoi] } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
    return newPoi.id;
  }, [user]);

  const updatePoi = useCallback((tripId, poiId, updates) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? { ...t, pois: t.pois.map(p => p.id === poiId ? { ...p, ...updates } : p) }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const togglePoiActive = useCallback((tripId, poiId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? { ...t, pois: t.pois.map(p => p.id === poiId ? { ...p, isActive: p.isActive === false ? true : false } : p) }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const removePoi = useCallback((tripId, poiId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? {
            ...t,
            pois: t.pois.filter(p => p.id !== poiId),
            distances: t.distances.filter(d => d.poiId !== poiId),
          }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- ACCOMMODATIONS ----
  const addAccommodation = useCallback((tripId, acc) => {
    const newAcc = {
      id: generateId(),
      name: acc.name,
      address: acc.address || '',
      lat: acc.lat,
      lng: acc.lng,
      pricePerNight: acc.pricePerNight || null,
      placeId: acc.placeId || null,
      photoUrl: acc.photoUrl || null,
      notas: acc.notas || '',
      fuente: acc.fuente || 'manual',
      addedAt: new Date().toISOString(),
    };
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, accommodations: [...t.accommodations, newAcc] } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
    return newAcc.id;
  }, [user]);

  const removeAccommodation = useCallback((tripId, accId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? {
            ...t,
            accommodations: t.accommodations.filter(a => a.id !== accId),
            distances: t.distances.filter(d => d.accommodationId !== accId),
            selectedAccommodation: t.selectedAccommodation === accId ? null : t.selectedAccommodation,
          }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const toggleAccommodationActive = useCallback((tripId, accId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? { ...t, accommodations: t.accommodations.map(a => a.id === accId ? { ...a, isActive: a.isActive === false ? true : false } : a) }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const selectAccommodation = useCallback((tripId, accId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, selectedAccommodation: accId } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- DISTANCES ----
  // Guarda registros de distancia por (accommodationId, poiId) FUSIONANDO campos: así
  // el cálculo perezoso de andando/transporte no borra el tiempo en coche ya guardado
  // (y viceversa). Cada registro puede traer solo los campos de un modo.
  const saveDistances = useCallback((tripId, distanceRecords) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => {
        if (t.id !== tripId) return t;
        const merged = [...(t.distances || [])];
        distanceRecords.forEach(nr => {
          const idx = merged.findIndex(d => d.accommodationId === nr.accommodationId && d.poiId === nr.poiId);
          if (idx >= 0) merged[idx] = { ...merged[idx], ...nr };
          else merged.push(nr);
        });
        return { ...t, distances: merged };
      });
      const updatedTrip = newTrips.find(t => t.id === tripId);
      persistTrip(newTrips, updatedTrip);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  return {
    trips: data.trips,
    activeTrip: data.activeTrip,
    loading: data.loading,
    getActiveTrip,
    createTrip,
    deleteTrip,
    setActiveTrip,
    updateTrip,
    importTripData,
    shareTrip,
    removeCollaborator,
    addPoi,
    updatePoi,
    removePoi,
    togglePoiActive,
    addAccommodation,
    removeAccommodation,
    toggleAccommodationActive,
    selectAccommodation,
    saveDistances,
  };
}
