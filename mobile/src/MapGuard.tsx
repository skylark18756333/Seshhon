// If the native map throws while drawing (a bad or missing Google Maps key, a phone without Google Play services),
// the Map tab gives up quietly and App.tsx shows the web map instead, so the tab never leaves a crashed screen.
import React from 'react';

export class MapGuard extends React.Component<{ onFail: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}
