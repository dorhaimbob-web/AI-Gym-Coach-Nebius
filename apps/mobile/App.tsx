import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { palette, spacing, type as typeScale } from '@gymcoach/shared';

export default function App() {
  const scheme = useColorScheme();
  const theme = palette[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      <Text
        style={{
          color: theme.ink,
          fontSize: typeScale.screenTitle.size,
          fontWeight: '800',
          letterSpacing: typeScale.screenTitle.letterSpacing,
        }}
      >
        GymCoach AI
      </Text>
      <Text style={{ color: theme.inkSoft, marginTop: spacing.sm }}>
        M0 scaffold — screens land in M2
      </Text>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
