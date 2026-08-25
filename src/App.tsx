import { PamProvider, usePam } from './state/store';
import Login from './screens/Login';
import Shell, { ToastHost } from './screens/Shell';
import Dashboard from './screens/Dashboard';
import Launcher, { TargetSessionOverlay } from './screens/Launcher';
import Vault from './screens/Vault';
import Access from './screens/Access';
import { UsersPage, SecurityPage, SettingsPage } from './screens/Admin';
import Reports from './screens/Reports';
import Architecture from './screens/Architecture';

function Router() {
  const { phase, route } = usePam();

  if (phase !== 'console') {
    return <Login />;
  }

  return (
    <Shell>
      {route === 'dashboard' && <Dashboard />}
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
