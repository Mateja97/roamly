import { useEffect, useState } from 'react';
import { fetchHealth } from './api/health';

type Status = 'checking' | 'ok' | 'error';

function App() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    fetchHealth()
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  const label =
    status === 'checking' ? 'checking…' : status === 'ok' ? 'healthy' : 'unreachable';

  return (
    <main>
      <h1>claude-workspace-template</h1>
      <p>proxy-service: {label}</p>
    </main>
  );
}

export default App;
