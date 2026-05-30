import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetRefresh } from '../widget/widgetTaskHandler';
import { colors } from '../constants/theme';

export default function SetupScreen() {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'error'; msg: string }>({
    type: 'idle',
    msg: '',
  });

  useEffect(() => {
    (async () => {
      const savedUrl = await AsyncStorage.getItem('noteflow_url');
      const savedToken = await AsyncStorage.getItem('noteflow_token');
      if (savedUrl) setUrl(savedUrl);
      if (savedToken) setToken(savedToken);
    })();
  }, []);

  async function handleSaveAndTest() {
    const trimUrl = url.trim().replace(/\/$/, '');
    const trimToken = token.trim();
    if (!trimUrl || !trimToken) {
      setStatus({ type: 'error', msg: 'Both URL and token are required.' });
      return;
    }
    setStatus({ type: 'loading', msg: 'Testing connection…' });
    try {
      const r = await fetch(
        `${trimUrl}/api/widget/tasks?token=${encodeURIComponent(trimToken)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setStatus({ type: 'error', msg: `Error ${r.status}: ${body.error ?? 'Unknown error'}` });
        return;
      }
      const data = await r.json();
      const count = (data.tasks ?? []).length;
      await AsyncStorage.setItem('noteflow_url', trimUrl);
      await AsyncStorage.setItem('noteflow_token', trimToken);
      await registerWidgetRefresh();
      setStatus({ type: 'ok', msg: `Connected! ${count} pending task${count !== 1 ? 's' : ''} found.` });
    } catch (e: any) {
      setStatus({ type: 'error', msg: e?.message ?? 'Connection failed' });
    }
  }

  function handleAddWidget() {
    Alert.alert(
      'Add Widget',
      'Long-press your home screen → tap "Widgets" → find "NoteFlow Tasks" and drag it to your home screen.',
      [{ text: 'Got it' }]
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>NoteFlow Widget</Text>
        <Text style={styles.subheading}>
          Enter your NoteFlow URL and widget token to connect.{'\n'}
          Generate the token in NoteFlow → Settings → Android Widget.
        </Text>

        <Text style={styles.label}>NoteFlow URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://notes.jeppesen.cc"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>Widget Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="Paste token from NoteFlow settings"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={false}
        />

        {status.type !== 'idle' && (
          <View style={[styles.statusBox, status.type === 'ok' ? styles.statusOk : status.type === 'error' ? styles.statusError : styles.statusLoading]}>
            {status.type === 'loading' ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.statusText}>{status.msg}</Text>
          </View>
        )}

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPressed]}
          onPress={handleSaveAndTest}
          disabled={status.type === 'loading'}
        >
          <Text style={styles.btnTextPrimary}>Save &amp; Test</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.btnPressed]}
          onPress={handleAddWidget}
        >
          <Text style={styles.btnTextSecondary}>Add Widget to Home Screen</Text>
        </Pressable>

        <Text style={styles.footer}>
          The widget refreshes every 15–30 minutes automatically. Tap the ↺ icon on the widget for an immediate refresh.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    flexGrow: 1,
  },
  heading: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  subheading: {
    fontSize: 14,
    color: colors.muted,
    marginBottom: 28,
    lineHeight: 20,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  statusOk: { backgroundColor: '#1a3a1a' },
  statusError: { backgroundColor: '#3a1a1a' },
  statusLoading: { backgroundColor: colors.surface },
  statusText: { color: colors.text, fontSize: 13, flex: 1 },
  btn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnPressed: { opacity: 0.7 },
  btnTextPrimary: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextSecondary: { color: colors.text, fontSize: 15 },
  footer: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});
