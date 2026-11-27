// Getting there and home: Walk, Ride (Uber) and Train/bus buttons for a place. Each opens Google Maps or Uber with the
// place filled in. Nothing about where you are is sent from Crewzy: the maps or Uber app works out your start itself.
// at is [lat, lng] when the place is on the map; otherwise the name is searched.
import React from 'react';
import { Alert, Linking, StyleSheet, View } from 'react-native';
import { sendMessage } from './api';
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

// Ride books for you. In a sesh, "Order for the group" fits the group: up to 4 is one normal ride; 5 or 6 suggests an
// UberXL (picked in the Uber app: Uber's links can't choose the ride type without Uber's own developer key) or two
// rides; 7 or more needs two rides.
// "Split into 2 rides" opens Uber for you and asks the sesh chat for someone to book the second one.
export default function GettingThere({ name, at, onFail, sesh }: {
  name: string; at?: [number, number] | null; onFail?: (m: string) => void; sesh?: { id: string; members: unknown[] } | null;
}) {
  const open = (url: string) => Linking.openURL(url).catch(() => onFail && onFail("Couldn't open that."));
  const people = sesh ? sesh.members.length : 0;
  const split = () => {
    open(rideUrl(name, at));
    if (sesh) sendMessage(sesh.id, '🚗 Splitting into 2 rides to ' + name + '. Can someone book the second one?').catch(() => onFail && onFail("Couldn't ask the sesh chat."));
  };
  // Ride is a normal ride for you. In a sesh of 2 or more, "Order for the group" is the second choice, sized to the sesh.
  const group = () => {
    if (people <= 4) { open(rideUrl(name, at)); return; }
    const opts: { text: string; onPress?: () => void; style?: 'cancel' }[] = people <= 6
      ? [{ text: 'UberXL (pick XL in Uber)', onPress: () => open(rideUrl(name, at)) }, { text: 'Split into 2 rides', onPress: split }]
      : [{ text: 'Split into 2 rides', onPress: split }];
    Alert.alert(people + ' of you', people <= 6 ? 'Too many for one normal ride. Book an UberXL (seats 6), or split into 2 rides.'
      : 'Too many for one car, even an XL (seats 6). Split into 2 rides.', opts.concat([{ text: 'Cancel', style: 'cancel' }]));
  };
  const ride = () => {
    if (people < 2) { open(rideUrl(name, at)); return; }
    Alert.alert('Ride to ' + name, undefined, [
      { text: 'Just me', onPress: () => open(rideUrl(name, at)) },
      { text: 'Order for the group (' + people + ')', onPress: group },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };
  return (
    <View style={styles.row}>
      <View style={styles.cell}><Button ghost small icon="map" label="Walk" onPress={() => open(walkUrl(name, at))} testID="go-walk" /></View>
      <View style={styles.cell}><Button ghost small label="Ride" onPress={ride} testID="go-ride" /></View>
      <View style={styles.cell}><Button ghost small label="Train/bus" onPress={() => open(transitUrl(name, at))} testID="go-transit" /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, minWidth: 0 }
});
