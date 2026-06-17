import React from 'react';
import { View } from 'react-native';

/**
 * Tiny bar sparkline rendered with plain Views (no SVG / native dep, so it ships
 * over-the-air). Mirrors the web Fed page's per-metric history sparkline.
 */
export default function Sparkline({
  data,
  color,
  height = 26,
}: {
  data?: number[] | null;
  color: string;
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height }}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            marginHorizontal: 0.5,
            height: 3 + ((v - min) / rng) * (height - 3),
            backgroundColor: color,
            borderRadius: 1,
          }}
        />
      ))}
    </View>
  );
}
