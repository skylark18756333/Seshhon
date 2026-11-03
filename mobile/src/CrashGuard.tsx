// Keeps a problem in the app's code from closing the app. If drawing a screen throws, or other code throws an error
// the app didn't expect (a tap, a swipe, a timer), this shows a "Something went wrong" screen with the error itself
// (so a screenshot tells us what broke) and a Try again button, instead of the phone saying "Crewzy keeps stopping".
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type Caught = { message: string; where: string };
let listener: ((e: Caught) => void) | null = null;
let pending: Caught | null = null;

function describe(error: unknown): string {
  if (error instanceof Error) return (error.name ? error.name + ': ' : '') + error.message;
  return String(error);
}
function firstLines(text: string | null | undefined): string {
  return (text || '').trim().split('\n').slice(0, 8).join('\n');
}

type Handler = (error: unknown, fatal?: boolean) => void;
const utils = (globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void } }).ErrorUtils;
if (utils) {
  const before = utils.getGlobalHandler();
  utils.setGlobalHandler((error, fatal) => {
    if (!fatal) { before(error, fatal); return; }   // only errors that would close the app are caught here
    const caught = { message: describe(error), where: firstLines(error instanceof Error ? error.stack : '') };
    if (listener) listener(caught); else pending = caught;
  });
}

export class CrashGuard extends React.Component<{ children: React.ReactNode }, { caught: Caught | null }> {
  state: { caught: Caught | null } = { caught: pending };
  componentDidMount() { listener = (caught) => this.setState({ caught }); }
  componentWillUnmount() { listener = null; }
  static getDerivedStateFromError(error: unknown) { return { caught: { message: describe(error), where: '' } }; }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    this.setState({ caught: { message: describe(error), where: firstLines(info && info.componentStack) } });
  }
  render() {
    const c = this.state.caught;
    if (!c) return this.props.children;
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>Crewzy hit a problem on this screen. Please screenshot this for us, then tap Try again.</Text>
        <ScrollView style={styles.box}><Text style={styles.code} selectable>{c.message}{c.where ? '\n\n' + c.where : ''}</Text></ScrollView>
        <Pressable style={styles.button} onPress={() => { pending = null; this.setState({ caught: null }); }} accessibilityRole="button" testID="crash-retry">
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050506', padding: 24, paddingTop: 80, gap: 14 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  body: { color: '#C9CBD2', fontSize: 15, lineHeight: 21 },
  box: { maxHeight: 320, backgroundColor: '#15161B', borderRadius: 12, padding: 12 },
  code: { color: '#F5C542', fontSize: 12, fontFamily: 'monospace' },
  button: { backgroundColor: '#3DDC84', borderRadius: 24, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#04210F', fontSize: 16, fontWeight: '800' }
});
