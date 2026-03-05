import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export function useTripStore() {
  const [data, setData] = useState({ trips: [], activeTrip: null, loading: true });
  const { user } = useAuthStore();

  const loadTrips = useCallback(async () => {
    if (!user) {
      setData({ trips: [], activeTrip: null, loading: false });
      return;
    }
    setData(prev => ({ ...prev, loading: true }));
    try {
      const { data: dbTrips, error } = await supabase
        .from('trips')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const safeParse = (val) => {
        if (!val) return [];
        if (typeof val === 'string') {
          try { return JSON.parse(val); } catch (e) { return []; }
        }
        return Array.isArray(val) ? val : [];
      };

      // Parse JSON fields from Supabase
      const parsedTrips = (dbTrips || []).map(t => ({
        id: t.id,
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
        createdAt: t.created_at,
      }));

      setData(prev => ({ ...prev, trips: parsedTrips, loading: false }));
    } catch (error) {
      console.error('Error loading trips:', error);
      setData(prev => ({ ...prev, loading: false }));
    }
  }, [user]);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const saveTripsToDb = async (tripsToSave) => {
    if (!user) return;
    const dbFormat = tripsToSave.map(t => ({
      id: t.id,
      user_id: user.id,
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
    }));

    try {
      const { error } = await supabase.from('trips').upsert(dbFormat);
      if (error) throw error;
    } catch (error) {
      console.error('Error saving trip to Supabase:', error);
    }
  };

  // ---- TRIPS ----
  const createTrip = useCallback(async (trip) => {
    const newTrip = {
      id: generateId(),
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
      createdAt: new Date().toISOString(),
    };

    await saveTripsToDb([newTrip]); // Guardar a DB y esperar confirmación

    setData(prev => {
      const newTrips = [...prev.trips, newTrip];
      return { ...prev, trips: newTrips, activeTrip: newTrip.id };
    });
    return newTrip.id;
  }, [user]);

  const deleteTrip = useCallback(async (tripId) => {
    setData(prev => ({
      ...prev,
      trips: prev.trips.filter(t => t.id !== tripId),
      activeTrip: prev.activeTrip === tripId ? null : prev.activeTrip,
    }));
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
      if (updatedTrip) saveTripsToDb([updatedTrip]);
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
      lat: poi.lat,
      lng: poi.lng,
      address: poi.address || '',
      rating: poi.rating || null,
      photoUrl: poi.photoUrl || null,
      visitFrequency: poi.visitFrequency || 1,
      openingHours: poi.openingHours || null,
      addedAt: new Date().toISOString(),
    };
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, pois: [...t.pois, newPoi] } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      if (updatedTrip) saveTripsToDb([updatedTrip]);
      return { ...prev, trips: newTrips };
    });
    return newPoi.id;
  }, [user]);

  const updatePoi = useCallback((tripId, poiId, updates) => {
    setData(prev => {
      const newTrips = prev.trips.map(t =>
        t.id === tripId
          ? {
            ...t,
            pois: t.pois.map(p => p.id === poiId ? { ...p, ...updates } : p)
          }
          : t
      );
      const updatedTrip = newTrips.find(t => t.id === tripId);
      if (updatedTrip) saveTripsToDb([updatedTrip]);
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
      if (updatedTrip) saveTripsToDb([updatedTrip]);
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
      addedAt: new Date().toISOString(),
    };
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, accommodations: [...t.accommodations, newAcc] } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      if (updatedTrip) saveTripsToDb([updatedTrip]);
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
      if (updatedTrip) saveTripsToDb([updatedTrip]);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  const selectAccommodation = useCallback((tripId, accId) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => t.id === tripId ? { ...t, selectedAccommodation: accId } : t);
      const updatedTrip = newTrips.find(t => t.id === tripId);
      if (updatedTrip) saveTripsToDb([updatedTrip]);
      return { ...prev, trips: newTrips };
    });
  }, [user]);

  // ---- DISTANCES ----
  const saveDistances = useCallback((tripId, distanceRecords) => {
    setData(prev => {
      const newTrips = prev.trips.map(t => {
        if (t.id !== tripId) return t;
        const existing = t.distances.filter(d =>
          !distanceRecords.some(nr =>
            nr.accommodationId === d.accommodationId && nr.poiId === d.poiId
          )
        );
        return { ...t, distances: [...existing, ...distanceRecords] };
      });
      const updatedTrip = newTrips.find(t => t.id === tripId);
      if (updatedTrip) saveTripsToDb([updatedTrip]);
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
    addPoi,
    updatePoi,
    removePoi,
    addAccommodation,
    removeAccommodation,
    selectAccommodation,
    saveDistances,
  };
}
