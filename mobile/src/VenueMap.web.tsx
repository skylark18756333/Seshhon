// The browser build (tools/live/native.mjs test only): react-native-maps can't draw there, so a plain stand-in.
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export default function VenueMap({ dark, onPress }: { at: [number, number]; dark: boolean; pin: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[StyleSheet.absoluteFill, { backgroundColor: dark ? '#14161c' : '#ECE9E3', alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: 34 }}>{'\u{1F4CD}'}</Text>
    </Pressable>
  );
}
