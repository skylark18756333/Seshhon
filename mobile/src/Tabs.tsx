// The tab bar at the bottom: Home, Sesh, Map and Events (venues live in the Map tab, with its List button). Home is
// the native screen; the others open the packed web app on that tab. The glowing GO button in the middle gets you
// out: it opens tonight's sesh, or goes green and starts one.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { C, F, themed } from './theme';

const TABS: [string, string][] = [['home', 'Home'], ['sesh', 'Sesh'], ['map', 'Map'], ['events', 'Events']];

export default function Tabs({ tab, requests, onPick, onGo }: { tab: string; requests: number; onPick: (tab: string) => void; onGo?: () => void }) {
  return (
    <View style={styles.nav} accessibilityRole="tablist" accessibilityLabel="Sections">
      {TABS.map(([key, name], i) => {
        const here = key === tab;
        return (
          <React.Fragment key={key}>
          {onGo && i === 2 ? (
            <Pressable style={styles.goSlot} onPress={onGo} accessibilityRole="button" accessibilityLabel="Go out" testID="go">
              <LinearGradient colors={['#6CF5A8', '#1FA858']} start={{ x: 0.3, y: 0 }} end={{ x: 0.7, y: 1 }} style={styles.go}>
                <Text style={styles.goText}>GO</Text>
              </LinearGradient>
            </Pressable>
          ) : null}
          <Pressable
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
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  // A floating glass pill of icons. The open tab is a white circle.
  nav: {
    flexDirection: 'row', alignSelf: 'center', width: '88%', maxWidth: 360, marginTop: 6, marginBottom: 14, padding: 6,
    borderRadius: 32, borderWidth: 1, borderColor: C.line, backgroundColor: C.tabBg
  },
  button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  here: { backgroundColor: C.accent },
  badge: { position: 'absolute', top: 4, left: '50%', marginLeft: 6, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: C.off, alignItems: 'center', justifyContent: 'center' },
  goSlot: { width: 64, alignItems: 'center', justifyContent: 'center' },
  go: {
    width: 64, height: 64, marginTop: -30, borderRadius: 32, borderWidth: 4, borderColor: C.bg, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.on, shadowOpacity: 0.8, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8
  },
  goText: { fontFamily: F.display, fontSize: 17, letterSpacing: 0.5, color: '#04210F' },
  badgeText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }
}));
