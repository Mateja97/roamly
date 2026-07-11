import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fetchHealth } from './src/api/health';
import { colors, fontSize, space } from './src/theme/tokens';

type Status = 'checking' | 'ok' | 'error';

export default function App() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    fetchHealth()
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'));
  }, []);

  const label =
    status === 'checking' ? 'checking…' : status === 'ok' ? 'healthy' : 'unreachable';

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>claude-workspace-template</Text>
      <Text style={styles.status}>proxy-service: {label}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  title: {
    color: colors.text,
    fontSize: fontSize.lg,
  },
  status: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
});
