import 'react-native-gesture-handler';
import React from 'react';
import { Text, ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <ScrollView contentContainerStyle={styles.err}>
          <Text style={styles.errTitle}>Startup crash — copy this and report it:</Text>
          <Text style={styles.errMsg}>{this.state.error.toString()}</Text>
          <Text style={styles.errStack}>{this.state.error.stack}</Text>
        </ScrollView>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  err: { padding: 20, backgroundColor: '#1a1a2e', flexGrow: 1 },
  errTitle: { color: '#ff6b6b', fontWeight: 'bold', fontSize: 14, marginBottom: 12 },
  errMsg: { color: '#e8e8f0', fontSize: 13, marginBottom: 12 },
  errStack: { color: '#8888a8', fontSize: 11, fontFamily: 'monospace' },
});

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#e8e8f0',
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: '#1a1a2e' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'NoteFlow Widget Setup' }} />
      </Stack>
    </ErrorBoundary>
  );
}
