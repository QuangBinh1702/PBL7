import './styles/globals.css';
import { Dashboard } from './components/Dashboard';
import { LegacyMarkup } from './components/LegacyMarkup';
import { useLegacyApp } from './hooks/useLegacyApp';

export default function App() {
  const isDashboard = window.location.pathname === '/dashboard';

  useLegacyApp(!isDashboard);

  if (isDashboard) {
    return <Dashboard />;
  }

  return <LegacyMarkup />;
}
