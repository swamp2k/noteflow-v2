import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetRefresh } from '../widget/widgetTaskHandler';
import { colors } from '../constants/theme';
import type { TextSize } from '../widget/tasksBridge';

const DEFAULT_API_URL = 'https://noteflow-api.jeppesen.cc';
const DEFAULT_APP_URL = 'https://notes.jeppesen.cc';

const TEXT_SIZE_LABELS: { value: TextSize; label: string }[] = [
  { value: 'small',  label: 'Small'  },
  { value: 'medium', label: 'Medium' },
  { value: 'large',  label: 'Large'  },
];

export default function SetupScreen() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [appUrl, setAppUrl] = useState(DEFAULT_APP_URL);
  const [token, setToken] = useState('');
  const [textSize, setTextSize] = useState<TextSize>('medium');
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<{ type: 'idle' | 'loading' | 'ok' | 'error'; msg: string }>({
    type: 'idle',
    msg: '',
  });

  useEffect(() => {
    (async () => {
      // Fall back to the legacy single-URL key for older installs.
      const savedApi =
        (await AsyncStorage.getItem('noteflow_api_url')) ??
        (await AsyncStorage.getItem('noteflow_url'));
      const savedApp  = await AsyncStorage.getItem('noteflow_app_url');
      const savedToken = await AsyncStorage.getItem('noteflow_token');
      const savedSize  = await AsyncStorage.getItem('noteflow_text_size');
      if (savedApi)  setApiUrl(savedApi);
      if (savedApp)  setAppUrl(savedApp);
      if (savedToken) setToken(savedToken);
      if (savedSize === 'small' || savedSize === 'medium' || savedSize === 'large') setTextSize(savedSize);
    })();
  }, []);

  async function handleSaveAndTest() {
    const trimApi   = apiUrl.trim().replace(/\/$/, '');
    const trimApp   = appUrl.trim().replace(/\/$/, '');
    const trimToken = token.trim();
    if (!trimApi || !trimApp || !trimToken) {
      setStatus({ type: 'error', msg: 'API URL, App URL and token are all required.' });
      return;
    }
    setStatus({ type: 'loading', msg: 'Testing connection…' });
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(
        `${trimApi}/api/widget/tasks?token=${encodeURIComponent(trimToken)}`,
        { signal: ctrl.signal }
      ).finally(() => clearTimeout(tid));
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        setStatus({ type: 'error', msg: `Error ${r.status}: ${body.error ?? 'Unknown error'}` });
        return;
      }
      const data  = await r.json();
      const count = (data.tasks ?? []).length;
      await AsyncStorage.setItem('noteflow_api_url', trimApi);
      await AsyncStorage.setItem('noteflow_app_url', trimApp);
      await AsyncStorage.setItem('noteflow_token',   trimToken);
      // Keep the legacy key in sync so existing widget code keeps working.
      await AsyncStorage.setItem('noteflow_url', trimApi);
      await registerWidgetRefresh();
      setStatus({ type: 'ok', msg: `Connected! ${count} pending task${count !== 1 ? 's' : ''} found.` });
    } catch (e: any) {
      setStatus({ type: 'error', msg: e?.message ?? 'Connection failed' });
    }
  }

  async function handleTextSize(size: TextSize) {
    setTextSize(size);
    await AsyncStorage.setItem('noteflow_text_size', size);
  }

  // Pull-to-refresh: re-fetches current task count to confirm the API is reachable.
  // The widget itself refreshes on Android's schedule (every ~30 min); this is a
  // connectivity check so you can see live task data without waiting.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      const savedApi =
        (await AsyncStorage.getItem('noteflow_api_url')) ??
        (await AsyncStorage.getItem('noteflow_url'));
      const savedToken = await AsyncStorage.getItem('noteflow_token');
      if (savedApi && savedToken) {
        const ctrl = new AbortController();
        const tid  = setTimeout(() => ctrl.abort(), 10000);
        const r = await fetch(
          `${savedApi}/api/widget/tasks?token=${encodeURIComponent(savedToken)}`,
          { signal: ctrl.signal }
        ).finally(() => clearTimeout(tid));
        if (r.ok) {
          const data  = await r.json();
          const count = (data.tasks ?? []).length;
          setStatus({ type: 'ok', msg: `${count} pending task${count !== 1 ? 's' : ''} right now.` });
        } else {
          setStatus({ type: 'error', msg: `API returned ${r.status} — check your token.` });
        }
      }
    } catch {
      setStatus({ type: 'error', msg: 'Could not reach API. Check your connection.' });
    } finally {
      setRefreshing(false);
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
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.accent]}
            tintColor={colors.accent}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <Text style={styles.heading}>NoteFlow Widget</Text>
        <Text style={styles.subheading}>
          Enter your NoteFlow URLs and widget token to connect.{'\n'}
          Generate the token in NoteFlow → Settings → Android Widget.
        </Text>

        <Text style={styles.label}>API URL</Text>
        <Text style={styles.hint}>Where the widget fetches tasks from.</Text>
        <TextInput
          style={styles.input}
          value={apiUrl}
          onChangeText={setApiUrl}
          placeholder="https://noteflow-api.jeppesen.cc"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={styles.label}>App URL</Text>
        <Text style={styles.hint}>Opened when you tap a task (your PWA).</Text>
        <TextInput
          style={styles.input}
          value={appUrl}
          onChangeText={setAppUrl}
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

        <Text style={[styles.label, { marginTop: 20 }]}>Widget Text Size</Text>
        <View style={styles.sizeRow}>
          {TEXT_SIZE_LABELS.map(({ value, label }) => (
            <Pressable
              key={value}
              style={[styles.sizeBtn, textSize === value && styles.sizeBtnActive]}
              onPress={() => handleTextSize(value)}
            >
              <Text style={[styles.sizeBtnText, textSize === value && styles.sizeBtnTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {status.type !== 'idle' && (
          <View style={[
            styles.statusBox,
            status.type === 'ok'      ? styles.statusOk      :
            status.type === 'error'   ? styles.statusError   :
                                        styles.statusLoading,
          ]}>
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
          <Text style={styles.btnTextPrimary}>{'Save & Test'}</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.btnPressed]}
          onPress={handleAddWidget}
        >
          <Text style={styles.btnTextSecondary}>Add Widget to Home Screen</Text>
        </Pressable>

        <Text style={styles.footer}>
          The widget refreshes automatically every ~30 minutes.{'\n'}
          Pull down on this screen to check the current task count.{'\n'}
          To disable battery optimization: Settings → Apps → NoteFlow Widget → Battery → Unrestricted.
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
    marginBottom: 2,
    marginTop: 16,
  },
  hint: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: 6,
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
  sizeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  sizeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sizeBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  sizeBtnText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
  },
  sizeBtnTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    padding: 12,
    marginTop: 16,
  },
  statusOk:      { backgroundColor: '#1a3a1a' },
  statusError:   { backgroundColor: '#3a1a1a' },
  statusLoading: { backgroundColor: colors.surface },
  statusText: { color: colors.text, fontSize: 13, flex: 1 },
  btn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  btnPrimary:   { backgroundColor: colors.accent },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnPressed:   { opacity: 0.7 },
  btnTextPrimary:   { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnTextSecondary: { color: colors.text, fontSize: 15 },
  footer: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 18,
  },
});
