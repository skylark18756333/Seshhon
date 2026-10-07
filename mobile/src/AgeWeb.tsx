// The provider's age check page (Didit or Yoti) in a window over the app. It is the provider's own web page, so
// it can't be done natively; when it sends the person back to the Frendzy address (?age_check=done) the window
// closes and the native screen asks the database how it went.
import Constants from 'expo-constants';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { C, F } from './theme';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
const WEB_ORIGIN = new URL(WEB_URL).origin;

export default function AgeWeb({ url, onReturn, onClose }: { url: string; onReturn: () => void; onClose: () => void }) {
  const inset = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.fill, { paddingTop: inset.top, paddingBottom: inset.bottom }]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <WebView
          source={{ uri: url }}
          style={styles.fill}
          originWhitelist={['https://*', 'http://*', 'about:*']}
          onShouldStartLoadWithRequest={(req) => {
            let own = false;
            try { own = new URL(req.url).origin === WEB_ORIGIN; } catch (e) {}
            if (own) { onReturn(); return false; }
            return true;
          }}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12 },
  close: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  closeText: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg }
});
