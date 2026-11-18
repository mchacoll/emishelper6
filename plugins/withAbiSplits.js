// ملف APK لكل نوع معالج (أصغر بكثير من الملف الشامل) + ملف شامل للنسخ القديمة من التطبيق
// المخرجات: app-arm64-v8a-release.apk و app-armeabi-v7a-release.apk و app-universal-release.apk
const { withAppBuildGradle } = require('expo/config-plugins');

const BLOCK = `
    // [abi-splits]
    splits {
        abi {
            enable true
            reset()
            include "armeabi-v7a", "arm64-v8a"
            universalApk true
        }
    }
`;

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, cfg => {
    const src = cfg.modResults.contents;
    if (!src.includes('[abi-splits]')) {
      // داخل كتلة android { ... } الرئيسية (أول ظهور لها في السطر بلا مسافة بادئة)
      cfg.modResults.contents = src.replace(/^android\s*\{/m, m => m + BLOCK);
    }
    return cfg;
  });
};
