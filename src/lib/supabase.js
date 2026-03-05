import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const isValidUrl = supabaseUrl.startsWith('http');

// Configuración segura por si las variables no están aún en el archivo .env
export const supabase = isValidUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : {
        auth: {
            getSession: () => Promise.resolve({ data: { session: null } }),
            signInWithPassword: () => Promise.reject(new Error("Configura Supabase en el archivo .env")),
            signUp: () => Promise.reject(new Error("Configura Supabase en el archivo .env")),
            signOut: () => Promise.reject(new Error("Supabase no configurado")),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } })
        }
    };
