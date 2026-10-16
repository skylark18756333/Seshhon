// What the Map tab hands to the map itself. NativeMap.tsx draws it with Google Maps on the phone; NativeMap.web.tsx
// (used only by the browser test in tools/live, where react-native-maps can't draw a map) lists the same things.
export type LatLng = [number, number];

// One venue bubble (bubbleIcon in docs/app.js). kind: near = inside the circle or a search hit, far = a pin outside it,
// goal = the venue picked. busy is 0 to 3 (api_buzz); open is null when the hours are unknown.
export type MapMarker = {
  id: string; at: LatLng; name: string; kind: 'near' | 'far' | 'goal'; glyph: 'events' | 'fork' | 'venues';
  tag: string; busy: number; open: boolean | null; names: boolean;
  stop: { n: number; done: boolean } | null;   // a Sesh Map stop: drawn as a numbered circle
};

export type MapView = {
  centre: LatLng;             // the chosen spot, or the city centre
  radiusKm: number;
  chosen: boolean;            // false until someone taps the map or "Near me": no circle, no spot mark
  mine: boolean;              // the spot is the person's own location ("Near me"): drawn as "Me"
  meName: string;
  markers: MapMarker[];
  route: LatLng[];            // the Sesh Map's stops in order, joined by a dotted line
  fit: { key: number; coords: LatLng[] };   // when key changes the map moves to show these
  focus: { key: number; at: LatLng } | null;   // when key changes the map centres on this (a venue picked from a list)
  onPick: (id: string) => void;
  onMapPress: (at: LatLng) => void;
  onZoom: (names: boolean) => void;   // street names/venue names show once zoomed in (the web map's "names" class)
};
