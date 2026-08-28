/**
 * Keyrail PAM - Main Application (Real Implementation)
 * 
 * This is the real application entry point that uses the API client
 * instead of the simulated in-memory engine.
 */
import { PamProvider, usePam } from './state/store';
import Setup from './screens/Setup';
import Login from './screens/Login-new';
import Shell, { ToastHost } from './screens/Shell-new';
import Dashboard from './screens/Dashboard';
import Launcher, { TargetSessionOverlay } from './screens/Launcher';
import Vault from './screens/Vault';
import Access from './screens/Access';
import { UsersPage, SecurityPage, SettingsPage } from './screens/Admin';
import Reports from './screens/Reports';
import Architecture from './screens/Architecture';
import HowItWorks from './screens/HowItWorks';

function Router() {
  const { phase, route } = usePam();

  // Show setup screen if system hasn't been initialized
  if (phase === 'setup') {
    return <Setup />;
  }

  // Show login screen if not authenticated
  if (phase !== 'console') {
    return <Login />;
  }

  // Main application routes
  return (
    <Shell>
      {route === 'dashboard' && <Dashboard />}
      {route === 'how' && <HowItWorks />}
      {route === 'launcher' && <Launcher />}
      {route === 'vault' && <Vault />}
      {route === 'access' && <Access />}
      {route === 'users' && <UsersPage />}
      {route === 'security' && <SecurityPage />}
      {route === 'reports' && <Reports />}
      {route === 'architecture' && <Architecture />}
      {route === 'settings' && <SettingsPage />}
    </Shell>
  );
}

function Ambient() {
  return (
    <>
      <div className="bg-ambient" />
      <div className="bg-grid" />
      <div className="bg-noise" />
    </>
  );
}

export default function App() {
  return (
    <PamProvider>
      <Ambient />
      <Router />
      <TargetSessionOverlay />
      <ToastHost />
    </PamProvider>
  );
}
