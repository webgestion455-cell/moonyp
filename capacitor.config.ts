import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bkparibas.app',
  appName: 'BNP PARIBAS',
  webDir: 'dist',

  server: {
    url: 'https://apply.myinvest-capital.com/',
    cleartext: false
  },

  android: {
  allowMixedContent: true
}
};

export default config;