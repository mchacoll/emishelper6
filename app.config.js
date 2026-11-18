// رقم البناء يأتي من GitHub Actions (BUILD_NUMBER) ليزداد مع كل نسخة، فيعرف التطبيق أن هناك تحديثاً
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    versionCode: Number(process.env.BUILD_NUMBER || config.android.versionCode),
  },
});
