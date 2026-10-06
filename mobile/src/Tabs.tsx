// The tab bar at the bottom, the same five tabs as the web app's nav. Home is the native screen; the others
// open the packed web app on that tab.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { C, F } from './theme';

const TABS: [string, string][] = [['home', 'Home'], ['sesh', 'Sesh'], ['map', 'Map'], ['venues', 'Venues'], ['events', 'Events']];

export default function Tabs({ tab, requests, onPick }: { tab: string; requests: number; onPick: (tab: string) => void }) {
  return (
    <View style={styles.nav} accessibilityRole="tablist" accessibilityLabel="Sections">
      {TABS.map(([key, name]) => {
        const here = key === tab;
        return (
          <Pressable
            key={key}
            style={[styles.button, here && styles.here]}
            onPress={() => onPick(key)}
            accessibilityRole="tab"
            accessibilityLabel={name}
            accessibilityState={{ selected: here }}
          >
            <Icon name={key} size={22} colour={here ? C.accentInk : C.muted} />
            {key === 'home' && requests > 0 ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{requests}</Text></View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // A floating glass pill of icons. The open tab is a white circle.
  nav: {
    flexDirection: 'row', alignSelf: 'center', width: '88%', maxWidth: 360, marginTop: 6, marginBottom: 14, padding: 6,
    borderRadius: 32, borderWidth: 1, borderColor: C.line, backgroundColor: 'rgba(18, 18, 22, 0.72)'
  },
  button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  here: { backgroundColor: C.accent },
  badge: { position: 'absolute', top: 4, left: '50%', marginLeft: 6, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: C.off, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }
});
