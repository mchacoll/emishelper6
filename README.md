# مساعد EMIS — تطبيق أندرويد

تطبيق أندرويد يشغّل سكربت **«مساعد EMIS – تعبئة تلقائية» v7.6.1** كما هو، بدون Tampermonkey.

## كيف يعمل
- في التطبيق نافذتان: **موقع الطلاب** و **EMIS** (تبديل بالتبويبات، أو عرضهما معاً بزر ◫).
- يُحقن السكربت (`userscript/emis-helper.user.js`) في الصفحتين، ويظهر الشريط الأزرق نفسه.
- دوال `GM_getValue / GM_setValue / GM_addValueChangeListener` تعمل عبر جسر داخل التطبيق
  (`src/bridge.ts`) ينقل القيم بين النافذتين ويحفظها على الهاتف، كما كانت تنتقل بين التبويبين في المتصفح.
- عند الضغط على «▶ ابدأ» في موقع الطلاب ينتقل التطبيق تلقائياً إلى EMIS للتعبئة، ويعود بعد الحفظ
  (يمكن إيقاف ذلك من ⚙ الإعدادات).
- من ⚙ يمكن تغيير رابط موقع الطلاب أو EMIS، ومسح بيانات المساعد، ورؤية سجل الأخطاء.

## تعديل السكربت
عدّل `userscript/emis-helper.user.js` ثم شغّل:
```
npm run embed
```

## بناء ملف APK
من GitHub: **Actions → Build APK → Run workflow**، ثم نزّل `emishelper-apk` من صفحة التشغيل.

محلياً (يحتاج Android SDK و Java 17):
```
npm ci
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
```

> المشروع السابق (المزامنة والتصدير) محفوظ كما هو في `emishelper-android-source-v3.zip`.
