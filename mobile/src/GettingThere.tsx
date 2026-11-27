// Getting there and home: Walk, Ride (Uber) and Train/bus buttons for a place. Each opens Google Maps or Uber with the
// place filled in. Nothing about where you are is sent from Crewzy: the maps or Uber app works out your start itself.
// at is [lat, lng] when the place is on the map; otherwise the name is searched.
import React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button } from './Parts';

function dest(name: string, at?: [number, number] | null): string {
  return at ? at[0] + ',' + at[1] : encodeURIComponent(name + ' Perth');
}
export function walkUrl(name: string, at?: [number, number] | null) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + dest(name, at);
}
// Public transport directions show the next services, which covers the last train home late at night.
export function transitUrl(name: string, at?: [number, number] | null) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=' + dest(name, at);
}
export function rideUrl(name: string, at?: [number, number] | null) {
  const nick = '&dropoff[nickname]=' + encodeURIComponent(name);
  return at
    ? 'https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=' + at[0] + '&dropoff[longitude]=' + at[1] + nick
    : 'https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=' + encodeURIComponent(name + ', Perth WA') + nick;
}

export default function GettingThere({ name, at, onFail }: { name: string; at?: [number, number] | null; onFail?: (m: string) => void }) {
  const open = (url: string) => Linking.openURL(url).catch(() => onFail && onFail("Couldn't open that."));
  return (
    <View style={styles.row}>
      <View style={styles.cell}><Button ghost small icon="map" label="Walk" onPress={() => open(walkUrl(name, at))} testID="go-walk" /></View>
      <View style={styles.cell}><Button ghost small label="Ride" onPress={() => open(rideUrl(name, at))} testID="go-ride" /></View>
      <View style={styles.cell}><Button ghost small label="Train/bus" onPress={() => open(transitUrl(name, at))} testID="go-transit" /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, minWidth: 0 }
});
