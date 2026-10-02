// Browser stand-in for the phone's storage, used only by the preview.
const AsyncStorage = {
  async getItem(key: string): Promise<string | null> { try { return localStorage.getItem(key); } catch { return null; } },
  async setItem(key: string, value: string): Promise<void> { try { localStorage.setItem(key, value); } catch { /* ignore */ } },
};
export default AsyncStorage;
