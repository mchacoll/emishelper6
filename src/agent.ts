import 'react-native-url-polyfill/auto';
import Anthropic from '@anthropic-ai/sdk';
import { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import * as SecureStore from 'expo-secure-store';

/* مساعد الأوامر: Claude يفهم الأمر المكتوب وينفّذه بأدوات التطبيق الموجودة فقط */

const KEY_STORE = 'anthropic_api_key_v1';
export const getApiKey = () => SecureStore.getItemAsync(KEY_STORE).catch(() => null);
export const setApiKey = (k: string) => (k ? SecureStore.setItemAsync(KEY_STORE, k.trim()) : SecureStore.deleteItemAsync(KEY_STORE));

/** أفعال التطبيق التي يستطيع المساعد استدعاءها (ينفّذها App.tsx) */
export type AppActions = {
  status: () => Promise<string>;
  openTab: (tab: 'site' | 'excel' | 'emis') => Promise<string>;
  reload: (pane: 'site' | 'emis') => Promise<string>;
  compare: () => Promise<string>;
  showCompare: () => Promise<string>;
  sendStudent: (id: number) => Promise<string>;
  markReviewed: () => Promise<string>;
  searchOps: (query: string, result: 'all' | 'ok' | 'fail') => Promise<string>;
  exportOps: () => Promise<string>;
  showOps: () => Promise<string>;
  checkUpdates: () => Promise<string>;
};

const SYSTEM = `أنت «مساعد الأوامر» داخل تطبيق «بوابة EMIS» على هاتف منسّق مدرسة في العراق.
التطبيق فيه تبويبان: «الطلاب» (موقع استمارات الطلاب) و«EMIS» (نظام وزارة التربية)، وتبويب Excel.
تنفّذ أوامر المستخدم باستدعاء الأدوات المتاحة فقط. لا تستطيع تغيير شكل التطبيق أو إضافة ميزات؛ إذا طُلب ذلك فقل إنه يحتاج تحديثاً من المطوّر.
قواعد:
- أجب بالعربية وباختصار (سطر إلى ثلاثة أسطر).
- لا تقل إن شيئاً تمّ إلا إذا أكدته نتيجة الأداة. إن فشلت الأداة فاذكر السبب كما جاء.
- إرسال طالب إلى EMIS يفتح نافذة معاينة، والمستخدم هو من يضغط «إرسال». أرسل طالباً واحداً في كل أمر فقط، ولا ترسل عدة طلاب دفعة واحدة أبداً.
- لمعرفة رقم الطالب (id) شغّل المقارنة أولاً ثم اختر الطالب بالاسم. إن تشابه أكثر من اسم فاسأل المستخدم.
- الأدوات التي تفتح شاشة (المعاينة، المقارنة، سجل العمليات) تغلق هذه النافذة؛ فاجعلها آخر خطوة.`;

const MODEL = 'claude-opus-5-5';

export type ChatTurn = Anthropic.Beta.BetaMessageParam;

function makeTools(a: AppActions) {
  return [
    betaTool({
      name: 'get_status',
      description: 'حالة التطبيق الآن: التبويب المفتوح، عمليات اليوم (نجحت/فشلت)، آخر مقارنة، النسخة.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.status(),
    }),
    betaTool({
      name: 'open_tab',
      description: 'فتح تبويب في التطبيق.',
      inputSchema: {
        type: 'object',
        properties: { tab: { type: 'string', enum: ['site', 'excel', 'emis'], description: 'site = موقع الطلاب' } },
        required: ['tab'],
        additionalProperties: false,
      },
      run: ({ tab }) => a.openTab(tab),
    }),
    betaTool({
      name: 'reload_page',
      description: 'إعادة تحميل صفحة موقع الطلاب أو صفحة EMIS.',
      inputSchema: {
        type: 'object',
        properties: { pane: { type: 'string', enum: ['site', 'emis'] } },
        required: ['pane'],
        additionalProperties: false,
      },
      run: ({ pane }) => a.reload(pane),
    }),
    betaTool({
      name: 'compare_with_emis',
      description:
        'يقارن طلاب موقع الطلاب مع EMIS (بالاسم الرباعي) ويعيد: العدد، وقائمة غير الموجودين في EMIS مع id كل طالب، وعدد الموجودين بدون «تمت المراجعة». يحتاج «إدارة الطلاب» مفتوحة في EMIS. قد يستغرق دقيقة.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.compare(),
    }),
    betaTool({
      name: 'show_compare_screen',
      description: 'يعرض شاشة المقارنة للمستخدم (بعد compare_with_emis). يغلق نافذة المساعد.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.showCompare(),
    }),
    betaTool({
      name: 'send_student_to_emis',
      description:
        'يفتح نافذة المعاينة لإرسال طالب واحد إلى EMIS؛ المستخدم يراجع ويضغط «إرسال» بنفسه. id من نتيجة compare_with_emis. يغلق نافذة المساعد.',
      inputSchema: {
        type: 'object',
        properties: { student_id: { type: 'integer' } },
        required: ['student_id'],
        additionalProperties: false,
      },
      run: ({ student_id }) => a.sendStudent(student_id),
    }),
    betaTool({
      name: 'mark_reviewed_for_existing',
      description: 'يحدد «تمت المراجعة» في موقع الطلاب لكل طالب موجود في EMIS بدون مراجعة (بعد compare_with_emis). يطلب تأكيد المستخدم.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.markReviewed(),
    }),
    betaTool({
      name: 'search_operations',
      description: 'بحث في سجل عمليات الإرسال والتعديل (الاسم أو المدرسة). يعيد حتى 30 نتيجة مع الوقت والنتيجة والسبب.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'جزء من الاسم أو المدرسة، أو فارغ للكل' },
          result: { type: 'string', enum: ['all', 'ok', 'fail'] },
        },
        required: ['query', 'result'],
        additionalProperties: false,
      },
      run: ({ query, result }) => a.searchOps(query, result),
    }),
    betaTool({
      name: 'export_operations_excel',
      description: 'تصدير سجل العمليات إلى ملف Excel ومشاركته.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.exportOps(),
    }),
    betaTool({
      name: 'show_operations_log',
      description: 'يفتح شاشة سجل العمليات. يغلق نافذة المساعد.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.showOps(),
    }),
    betaTool({
      name: 'check_for_updates',
      description: 'يفحص وجود تحديث للتطبيق.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => a.checkUpdates(),
    }),
  ];
}

const textOf = (m: Anthropic.Beta.BetaMessage) =>
  m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

/** يرسل الأمر ويشغّل الأدوات حتى ينتهي، ويعيد الرد والمحادثة الجديدة */
export async function runCommand(
  apiKey: string,
  history: ChatTurn[],
  command: string,
  actions: AppActions,
  onTool: (name: string) => void,
): Promise<{ reply: string; history: ChatTurn[] }> {
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const tools = makeTools(actions).map(t => ({
    ...t,
    run: async (input: never) => {
      onTool(t.name);
      try {
        return await (t.run as (i: never) => Promise<string>)(input);
      } catch (e) {
        return 'خطأ: ' + ((e as Error)?.message || String(e));
      }
    },
  }));
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    tools,
    max_iterations: 12,
    messages: [...history, { role: 'user', content: command }],
  });
  const final = await runner.runUntilDone();
  const msgs = [...runner.params.messages];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'assistant') msgs.push({ role: 'assistant', content: final.content });
  let reply = textOf(final);
  if (final.stop_reason === 'refusal') reply = reply || 'رفض النموذج تنفيذ هذا الأمر.';
  if (final.stop_reason === 'max_tokens') reply = reply || 'انقطع الرد قبل اكتماله.';
  return { reply: reply || 'تم.', history: msgs.slice(-40) };
}

/** رسالة خطأ مفهومة */
export function explainError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'مفتاح API غير صحيح — غيّره من زر المفتاح.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'المفتاح لا يملك صلاحية لهذا النموذج.';
  if (e instanceof Anthropic.RateLimitError) return 'طلبات كثيرة أو رصيد غير كافٍ — حاول بعد قليل.';
  if (e instanceof Anthropic.BadRequestError) return 'طلب غير مقبول: ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'لا يوجد اتصال بالإنترنت.';
  if (e instanceof Anthropic.APIError) return `خطأ من الخادم (${e.status}): ${e.message}`;
  return String((e as Error)?.message || e);
}
