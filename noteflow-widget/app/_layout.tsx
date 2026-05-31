import { Stack } from 'expo-router';
import '../widget/widgetTaskHandler';

export default function RootLayout() {
  return (
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
  );
}
