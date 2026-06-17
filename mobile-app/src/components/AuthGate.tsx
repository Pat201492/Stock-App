import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useClient } from '../context/ClientContext';
import { shared, colors, spacing } from '../theme';

/**
 * Wraps a screen's content. If the user isn't signed in, shows a sign-in
 * prompt with a button that routes to the Login screen instead of the content.
 */
export default function AuthGate({
  navigation,
  feature,
  children,
}: {
  navigation: any;
  feature: string;
  children: React.ReactNode;
}) {
  const { authToken } = useClient();
  if (authToken != null) return <>{children}</>;
  return (
    <View style={[shared.center, styles.wrap]} testID="auth-gate">
      <Text style={styles.icon}>🔒</Text>
      <Text style={styles.title}>Sign in to view your {feature}</Text>
      <Text style={styles.sub}>
        Your {feature} is tied to your account.
      </Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation?.navigate('Login')}
        testID="auth-gate-login"
      >
        <Text style={styles.buttonText}>Log in or sign up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl },
  icon: { fontSize: 40, marginBottom: spacing.md },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, textAlign: 'center' },
  sub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    marginTop: spacing.lg,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
