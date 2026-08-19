import AsyncStorage from "@react-native-async-storage/async-storage";

// Same shape/intent as the Storage module in the web app's app.js —
// getLanguage/setLanguage now, Firestore-backed favorites/history later
// (once User Accounts are added). Swap the internals here without
// touching any calling code elsewhere in the app.
const KEYS = {
  LANGUAGE: "ampohm_language",
  DMX_PROGRESS: "ampohm_dmx_progress",
};

export const Storage = {
  async getLanguage() {
    try {
      return await AsyncStorage.getItem(KEYS.LANGUAGE);
    } catch (e) {
      return null; // storage unavailable — fall back to default language
    }
  },
  async setLanguage(lang) {
    try {
      await AsyncStorage.setItem(KEYS.LANGUAGE, lang);
    } catch (e) {
      // non-fatal — language choice just won't persist this session
    }
  },

  // DMX field-work progress — which specific fixtures a technician has
  // physically addressed so far (tap-to-toggle, any order). Purely a
  // tracking convenience; never read by the address calculation itself.
  async getDmxProgress() {
    try {
      const raw = await AsyncStorage.getItem(KEYS.DMX_PROGRESS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  async setDmxProgress(flags, total) {
    try {
      await AsyncStorage.setItem(KEYS.DMX_PROGRESS, JSON.stringify({ flags, total }));
    } catch (e) {
      // non-fatal — progress just won't persist this session
    }
  },

  // getFavorites() / addFavorite() / getRecentCalculations() /
  // addRecentCalculation() will be added here once those features
  // are built (see App.js "FUTURE INTEGRATIONS" section).
};
