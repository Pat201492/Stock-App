import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { shared, colors, spacing } from '../theme';

function formatValue(v: unknown): string {
  if (v == null || v === '') return '–';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '–';
    // large magnitudes -> compact; otherwise up to 2 decimals
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  return '–';
}

function isPrimitive(v: unknown): boolean {
  return v == null || ['string', 'number', 'boolean'].includes(typeof v);
}

function prettyLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Section({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown>;
}) {
  // Drop the row id and any nested objects/arrays the backend may surface in JSON
  // columns — rendering them produces "[object Object]" noise.
  const entries = Object.entries(data).filter(
    ([k, v]) => k !== 'id' && isPrimitive(v),
  );
  if (entries.length === 0) return null;
  return (
    <View style={styles.section} testID={`section-${title}`}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={shared.card}>
        {entries.map(([k, v], i) => (
          <View
            key={k}
            style={[styles.kvRow, i === entries.length - 1 && styles.kvRowLast]}
          >
            <Text style={styles.kvKey}>{prettyLabel(k)}</Text>
            <Text style={styles.kvVal}>{formatValue(v)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export interface LineRow {
  primary: string;
  secondary?: string;
  right?: string;
  sub?: string;
}

export function ListSection({
  title,
  rows,
  emptyText,
}: {
  title: string;
  rows: LineRow[];
  emptyText: string;
}) {
  return (
    <View style={styles.section} testID={`section-${title}`}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={shared.card}>
        {rows.length === 0 ? (
          <Text style={styles.emptyLine}>{emptyText}</Text>
        ) : (
          rows.map((r, i) => (
            <View
              key={i}
              style={[styles.lineRow, i === rows.length - 1 && styles.kvRowLast]}
            >
              <View style={styles.lineLeft}>
                <Text style={styles.linePrimary}>{r.primary}</Text>
                {r.secondary ? (
                  <Text style={styles.lineSecondary}>{r.secondary}</Text>
                ) : null}
              </View>
              <View style={styles.lineRight}>
                {r.right ? <Text style={styles.lineRightTop}>{r.right}</Text> : null}
                {r.sub ? <Text style={styles.lineSub}>{r.sub}</Text> : null}
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  kvRowLast: {
    borderBottomWidth: 0,
  },
  kvKey: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  kvVal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'right',
    marginLeft: spacing.md,
  },
  emptyLine: {
    fontSize: 14,
    color: colors.textMuted,
    paddingVertical: 6,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  lineLeft: {
    flex: 1,
    marginRight: spacing.md,
  },
  lineRight: {
    alignItems: 'flex-end',
  },
  linePrimary: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  lineSecondary: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  lineRightTop: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  lineSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
