import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { Text, ScrollView, StyleSheet, View, StatusBar } from 'react-native';
import { Slot } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetRefresh } from '../widget/widgetTaskHandler';

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
  root: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    backgroundColor: '#1a1a2e',
    paddingTop: (StatusBar.currentHeight ?? 24) + 8,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a4a',
  },
  headerTitle: { color: '#e8e8f0', fontSize: 17, fontWeight: 'bold' },
  err: { padding: 20, backgroundColor: '#1a1a2e', flexGrow: 1 },
  errTitle: { color: '#ff6b6b', fontWeight: 'bold', fontSize: 14, marginBottom: 12 },
  errMsg: { color: '#e8e8f0', fontSize: 13, marginBottom: 12 },
  errStack: { color: '#8888a8', fontSize: 11, fontFamily: 'monospace' },
});

export default function RootLayout() {
  useEffect(() => {
    // Re-register on every app open. registerWidgetRefresh() itself no-ops if
    // already registered, so this is just insurance against the OS having
    // dropped the registration (e.g. after the app was force-stopped).
    (async () => {
      const token = await AsyncStorage.getItem('noteflow_token');
      if (token) {
        try {
          await registerWidgetRefresh();
        } catch (err) {
          console.error('Failed to re-register widget background refresh', err);
        }
      }
    })();
  }, []);

  return (
    <ErrorBoundary>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        <View style={styles.header}>
          <Text style={styles.headerTitle}>NoteFlow Widget Setup</Text>
        </View>
        <Slot />
      </View>
    </ErrorBoundary>
  );
}
