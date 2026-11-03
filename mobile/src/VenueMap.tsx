// The small map at the top of a venue's page: Google's "lite mode" picture of the spot (one still image, no panning),
// which is cheap to draw and can't lag the page. Tapping it opens directions.
import React from 'react';
import { StyleSheet } from 'react-native';
import RNMapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

// The dark Google map, the same as the Map tab's.
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#14161c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a90a0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#14161c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262a33' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0d12' }] }
];

export default function VenueMap({ at, dark, pin, onPress }: { at: [number, number]; dark: boolean; pin: string; onPress: () => void }) {
  return (
    <RNMapView
      provider={PROVIDER_GOOGLE}
      liteMode
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: at[0], longitude: at[1], latitudeDelta: 0.006, longitudeDelta: 0.006 }}
      customMapStyle={dark ? DARK_STYLE : []}
      scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
      toolbarEnabled={false}
      onPress={onPress}
    >
      <Marker coordinate={{ latitude: at[0], longitude: at[1] }} pinColor={pin} tracksViewChanges={false} />
    </RNMapView>
  );
}
