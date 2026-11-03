// Walking paths for the Sesh Map's dotted line, so it follows footpaths and streets instead of cutting through buildings.
// Uses the free OpenStreetMap foot router (FOSSGIS, no key). Only the venues' own coordinates are sent, never anyone's
// location. If the router can't be reached the line falls back to straight hops between the stops.
import { useEffect, useState } from 'react';
import type { LatLng } from './mapShared';

const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
const MAX_HOP_KM = 5;            // longer hops than this aren't walks: keep them straight
const cache: Record<string, LatLng[]> = {};

function km(a: LatLng, b: LatLng): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const keyOf = (a: LatLng, b: LatLng) => [a[0].toFixed(5), a[1].toFixed(5), b[0].toFixed(5), b[1].toFixed(5)].join(',');

async function hop(a: LatLng, b: LatLng): Promise<LatLng[]> {
  const k = keyOf(a, b);
  if (cache[k]) return cache[k];
  if (km(a, b) > MAX_HOP_KM) return [a, b];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`${ROUTER}${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`, { signal: ctl.signal });
    const j = await res.json();
    const pts: [number, number][] | undefined = j && j.code === 'Ok' && j.routes && j.routes[0] && j.routes[0].geometry && j.routes[0].geometry.coordinates;
    if (!pts || pts.length < 2) return [a, b];
    // Start and end exactly on the stops (the router snaps to the nearest path).
    const path: LatLng[] = [a, ...pts.map((c) => [c[1], c[0]] as LatLng), b];
    cache[k] = path;
    return path;
  } catch {
    return [a, b];
  } finally {
    clearTimeout(t);
  }
}

// The stops joined by walking paths. Shows straight hops straight away, then swaps in the paths once they arrive.
export function useWalkRoute(stops: LatLng[]): LatLng[] {
  const sig = stops.map((s) => s.join(',')).join(';');
  const [path, setPath] = useState<{ sig: string; pts: LatLng[] } | null>(null);
  useEffect(() => {
    if (stops.length < 2) return;
    let live = true;
    (async () => {
      const hops = await Promise.all(stops.slice(1).map((b, i) => hop(stops[i], b)));
      if (!live) return;
      const pts: LatLng[] = [];
      hops.forEach((h, i) => pts.push(...(i === 0 ? h : h.slice(1))));
      setPath({ sig, pts });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  return path && path.sig === sig ? path.pts : stops;
}
