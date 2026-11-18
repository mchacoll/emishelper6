// يحوّل userscript/emis-helper.user.js إلى src/userscript.generated.ts ليُحقن داخل التطبيق.
// شغّله بعد أي تعديل على السكربت:  npm run embed
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'userscript', 'emis-helper.user.js'), 'utf8');
const out =
  '// ملف مُولَّد تلقائياً من userscript/emis-helper.user.js — لا تعدّله يدوياً (npm run embed)\n' +
  'export const USERSCRIPT_SOURCE: string = ' + JSON.stringify(src) + ';\n';
writeFileSync(join(root, 'src', 'userscript.generated.ts'), out);
console.log('embedded', src.length, 'chars');
