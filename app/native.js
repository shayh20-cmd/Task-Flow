// Bridge to Android features, bundled into www/native.js by scripts/build-app.mjs.
// app.js talks only to window.RecipinNative, so the same UI also runs in a plain browser.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { CapacitorShareTarget } from '@capgo/capacitor-share-target';

window.RecipinNative = {
  isNative: Capacitor.isNativePlatform(),
  share: ({ title, text, url }) => Share.share({ title, text, url, dialogTitle: 'שיתוף מתכון' }),
  async saveFile(name, data) {
    const { uri } = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, files: [uri], dialogTitle: 'שמירת הגיבוי' });
  },
  onShare: (cb) => CapacitorShareTarget.addListener('shareReceived', cb),
  fileSrc: (uri) => Capacitor.convertFileSrc(uri),
  onBack: (cb) => App.addListener('backButton', cb),
  exitApp: () => App.exitApp(),
};
