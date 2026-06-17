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

export default function LoginScreen() {
  const { client, setAuthToken } = useClient();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const result = await client.login(email, password);
      setAuthToken(result.token);
      if (navigation.canGoBack()) navigation.goBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={shared.authContainer}>
      <Text style={shared.screenTitle}>Stock App</Text>
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
        onPress={handleLogin}
        disabled={loading}
        testID="login-button"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={shared.primaryButtonText}>Log In</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={shared.linkButton}
        onPress={() => navigation.navigate('Signup' as never)}
        testID="signup-link"
      >
        <Text style={shared.linkText}>Don't have an account? Sign Up</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, marginBottom: spacing.sm },
});
