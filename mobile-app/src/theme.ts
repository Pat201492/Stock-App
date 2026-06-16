import { StyleSheet } from 'react-native';

export const colors = {
  primary: '#007aff',
  background: '#f2f2f7',
  surface: '#ffffff',
  border: '#e0e0e0',
  divider: '#e8e8e8',
  text: '#1c1c1e',
  textSecondary: '#6c6c70',
  textMuted: '#8e8e93',
  error: '#c00',
  inactive: '#8e8e93',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  authContainer: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 13,
    marginBottom: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
  linkButton: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  linkText: {
    color: colors.primary,
    fontSize: 15,
  },
  row: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
  },
  errorText: {
    color: colors.error,
    fontSize: 15,
  },
  mutedText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  logoutButton: {
    padding: spacing.md,
    alignItems: 'flex-end',
    backgroundColor: colors.background,
  },
  logoutText: {
    color: colors.primary,
    fontSize: 15,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
  },
});
