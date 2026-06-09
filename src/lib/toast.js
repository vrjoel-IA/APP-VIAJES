// Sistema de notificaciones (toasts) + banner global de error de Mapas.
// Usa Zustand (ya es dependencia del proyecto) para un estado global ligero,
// con un helper imperativo `toast()` invocable desde cualquier sitio.
import { create } from 'zustand';

let nextId = 1;

export const useToastStore = create((set) => ({
  toasts: [],
  // Banner persistente para fallos de autenticación de Google Maps (clave/billing).
  mapsError: false,

  push: (message, type = 'info', duration = 3500) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setMapsError: (value) => set({ mapsError: value }),
}));

// Helper imperativo: toast('Guardado', 'success')
export function toast(message, type = 'info', duration = 3500) {
  return useToastStore.getState().push(message, type, duration);
}

export function reportMapsError() {
  useToastStore.getState().setMapsError(true);
}
