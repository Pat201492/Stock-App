import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useClient } from '../context/ClientContext';
import { shared, colors, spacing } from '../theme';

export default function SignupScreen() {
  const { client, setAuthToken } = useClient();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    setError(null);
    setLoading(true);
    try {
      const result = await client.signup(email, password);
      setAuthToken(result.token);
      // pop Signup then Login (if both on the stack) back to the gated tab
      if (navigation.canGoBack()) navigation.goBack();
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={shared.authContainer}>
      <Text style={shared.screenTitle}>Create Account</Text>
      <TextInput
        style={shared.input}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        testID="email-input"
      />
      <TextInput
        style={shared.input}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="password-input"
      />
      {error != null && (
        <Text style={styles.error} testID="error-message">
          {error}
        </Text>
      )}
      <TouchableOpacity
        style={shared.primaryButton}
        onPress={handleSignup}
        disabled={loading}
        testID="signup-button"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={shared.primaryButtonText}>Sign Up</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={shared.linkButton}
        onPress={() => navigation.goBack()}
        testID="back-to-login"
      >
        <Text style={shared.linkText}>Already have an account? Log In</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, marginBottom: spacing.sm },
});
