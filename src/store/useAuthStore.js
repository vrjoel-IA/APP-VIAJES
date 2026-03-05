import { create } from 'zustand';

export const useAuthStore = create((set) => ({
    session: null,
    user: null,
    loading: true,
    setSession: (session) => set({
        session,
        user: session?.user || null,
        loading: false
    }),
    signOut: () => set({ session: null, user: null, loading: false }),
}));
