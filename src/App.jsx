import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { useAuthStore } from './store/useAuthStore';
import NavBar from './components/NavBar';
import Explore from './pages/Explore';
import MyTrips from './pages/MyTrips';
import Profile from './pages/Profile';
import NewTrip from './pages/NewTrip';
import TripView from './pages/TripView';
import Login from './pages/Login';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', color: 'red', wordBreak: 'break-all' }}>
          <h2>Algo falló:</h2>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.error?.stack}</pre>
          <button onClick={() => window.location.reload()}>Recargar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const ProtectedRoute = ({ children }) => {
  const { session, loading } = useAuthStore();

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--color-primary)' }}>Cargando...</div>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default function App() {
  const { setSession, loading } = useAuthStore();

  useEffect(() => {
    // Verificar sesión inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    // Escuchar cambios de auth
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [setSession]);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--color-primary)' }}>Iniciando aplicación...</div>;
  }

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="app-layout">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><Explore /></ProtectedRoute>} />
            <Route path="/mis-viajes" element={<ProtectedRoute><MyTrips /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/new-trip" element={<ProtectedRoute><NewTrip /></ProtectedRoute>} />
            <Route path="/trip/:tripId" element={<ProtectedRoute><TripView /></ProtectedRoute>} />
          </Routes>
          <NavBar />
        </div>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
