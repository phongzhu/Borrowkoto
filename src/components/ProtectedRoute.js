import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function AuthLoadingScreen() {
  return (
    <div aria-live="polite" role="status" style={{ padding: 32, textAlign: 'center' }}>
      Checking your session…
    </div>
  );
}

export default function ProtectedRoute({ adminOnly = false }) {
  const { loading, role, user } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoadingScreen />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (adminOnly && role !== 'admin') {
    return <Navigate to="/user/dashboard" replace />;
  }

  return <Outlet />;
}
