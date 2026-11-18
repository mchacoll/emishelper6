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

type Spec = { name: string; description: string; props?: Record<string, { type: 'string' | 'integer'; enum?: string[]; description?: string }>; required?: string[]; run: (i: Record<string, unknown>) => Promise<string> };

function makeSpecs(a: AppActions): Spec[] {
  return [
    { name: 'get_status', description: 'حالة التطبيق الآن: التبويب المفتوح، عمليات اليوم (نجحت/فشلت)، آخر مقارنة، النسخة.', run: () => a.status() },
    {
      name: 'open_tab',
      description: 'فتح تبويب في التطبيق.',
      props: { tab: { type: 'string', enum: ['site', 'excel', 'emis'], description: 'site = موقع الطلاب' } },
      required: ['tab'],
      run: i => a.openTab(i.tab as 'site' | 'excel' | 'emis'),
    },
    {
      name: 'reload_page',
      description: 'إعادة تحميل صفحة موقع الطلاب أو صفحة EMIS.',
      props: { pane: { type: 'string', enum: ['site', 'emis'] } },
      required: ['pane'],
      run: i => a.reload(i.pane as 'site' | 'emis'),
    },
    {
      name: 'compare_with_emis',
      description:
        'يقارن طلاب موقع الطلاب مع EMIS (بالاسم الرباعي) ويعيد: العدد، وقائمة غير الموجودين في EMIS مع id كل طالب، وعدد الموجودين بدون «تمت المراجعة». يحتاج «إدارة الطلاب» مفتوحة في EMIS. قد يستغرق دقيقة.',
      run: () => a.compare(),
    },
    { name: 'show_compare_screen', description: 'يعرض شاشة المقارنة للمستخدم (بعد compare_with_emis). يغلق نافذة المساعد.', run: () => a.showCompare() },
    {
      name: 'send_student_to_emis',
      description: 'يفتح نافذة المعاينة لإرسال طالب واحد إلى EMIS؛ المستخدم يراجع ويضغط «إرسال» بنفسه. id من نتيجة compare_with_emis. يغلق نافذة المساعد.',
      props: { student_id: { type: 'integer' } },
      required: ['student_id'],
      run: i => a.sendStudent(Number(i.student_id)),
    },
    {
      name: 'mark_reviewed_for_existing',
      description: 'يحدد «تمت المراجعة» في موقع الطلاب لكل طالب موجود في EMIS بدون مراجعة (بعد compare_with_emis). يطلب تأكيد المستخدم.',
      run: () => a.markReviewed(),
    },
    {
      name: 'search_operations',
      description: 'بحث في سجل عمليات الإرسال والتعديل (الاسم أو المدرسة). يعيد حتى 30 نتيجة مع الوقت والنتيجة والسبب.',
      props: {
        query: { type: 'string', description: 'جزء من الاسم أو المدرسة، أو فارغ للكل' },
        result: { type: 'string', enum: ['all', 'ok', 'fail'] },
      },
      required: ['query', 'result'],
      run: i => a.searchOps(String(i.query ?? ''), (i.result as 'all' | 'ok' | 'fail') || 'all'),
    },
    { name: 'export_operations_excel', description: 'تصدير سجل العمليات إلى ملف Excel ومشاركته.', run: () => a.exportOps() },
    { name: 'show_operations_log', description: 'يفتح شاشة سجل العمليات. يغلق نافذة المساعد.', run: () => a.showOps() },
    { name: 'check_for_updates', description: 'يفحص وجود تحديث للتطبيق.', run: () => a.checkUpdates() },
  ];
}

const safeRun = async (sp: Spec, input: Record<string, unknown>, onTool: (n: string) => void) => {
  onTool(sp.name);
  try {
    return await sp.run(input || {});
  } catch (e) {
    return 'خطأ: ' + ((e as Error)?.message || String(e));
  }
};

function claudeTools(specs: Spec[], onTool: (n: string) => void) {
  return specs.map(sp =>
    betaTool({
      name: sp.name,
      description: sp.description,
      inputSchema: { type: 'object', properties: (sp.props || {}) as Record<string, never>, required: sp.required || [], additionalProperties: false } as {
        type: 'object';
      },
      run: (input: unknown) => safeRun(sp, input as Record<string, unknown>, onTool),
    }),
  );
}

const textOf = (m: Anthropic.Beta.BetaMessage) =>
  m.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

export type Provider = 'claude' | 'gemini';
// مفاتيح Claude تبدأ بـ sk-ant-؛ أي مفتاح آخر نعامله كمفتاح Google (AIza... أو الشكل الجديد AQ....)
export const providerOf = (key: string): Provider => (key.trim().startsWith('sk-ant-') ? 'claude' : 'gemini');

/** يرسل الأمر ويشغّل الأدوات حتى ينتهي، ويعيد الرد والمحادثة الجديدة (Claude أو Gemini حسب نوع المفتاح) */
export async function runCommand(
  apiKey: string,
  history: unknown[],
  command: string,
  actions: AppActions,
  onTool: (name: string) => void,
): Promise<{ reply: string; history: unknown[] }> {
  const specs = makeSpecs(actions);
  if (providerOf(apiKey) === 'gemini') return runGemini(apiKey, history, command, specs, onTool);

  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    tools: claudeTools(specs, onTool),
    max_iterations: 12,
    messages: [...(history as ChatTurn[]), { role: 'user', content: command }],
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

/* ---------- Google Gemini (مجاني ضمن حدود يومية) ---------- */
const GEMINI_MODEL = 'gemini-flash-latest';
type GPart = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: unknown };
type GContent = { role: 'user' | 'model'; parts: GPart[] };

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const gSchema = (sp: Spec) =>
  sp.props
    ? {
        type: 'OBJECT',
        properties: Object.fromEntries(
          Object.entries(sp.props).map(([k, v]) => [k, { type: v.type.toUpperCase(), ...(v.enum ? { enum: v.enum } : {}), ...(v.description ? { description: v.description } : {}) }]),
        ),
        required: sp.required || [],
      }
    : undefined;

async function runGemini(key: string, history: unknown[], command: string, specs: Spec[], onTool: (n: string) => void) {
  const contents: GContent[] = [...(history as GContent[]), { role: 'user', parts: [{ text: command }] }];
  const tools = [{ functionDeclarations: specs.map(sp => ({ name: sp.name, description: sp.description, ...(sp.props ? { parameters: gSchema(sp) } : {}) })) }];
  for (let step = 0; step < 12; step++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90_000);
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key.trim() },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, tools }),
        signal: ctl.signal,
      });
    } catch {
      throw new GeminiError(0, 'network');
    } finally {
      clearTimeout(timer);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new GeminiError(res.status, (j && j.error && j.error.message) || 'HTTP ' + res.status);
    const cand = j && j.candidates && j.candidates[0];
    const content: GContent | undefined = cand && cand.content;
    if (!content || !Array.isArray(content.parts)) {
      const why = (j && j.promptFeedback && j.promptFeedback.blockReason) || (cand && cand.finishReason) || 'رد فارغ';
      return { reply: 'لم يُنفَّذ الأمر (' + why + ').', history: contents.slice(-40) };
    }
    contents.push({ role: 'model', parts: content.parts });
    const calls = content.parts.filter(p => p.functionCall);
    if (!calls.length) {
      const reply = content.parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n').trim();
      return { reply: reply || 'تم.', history: contents.slice(-40) };
    }
    const out: GPart[] = [];
    for (const c of calls) {
      const sp = specs.find(x => x.name === c.functionCall!.name);
      const result = sp ? await safeRun(sp, c.functionCall!.args || {}, onTool) : 'أداة غير معروفة';
      out.push({ functionResponse: { name: c.functionCall!.name, response: { result } } });
    }
    contents.push({ role: 'user', parts: out });
  }
  return { reply: 'توقفت بعد خطوات كثيرة — جرّب أمراً أبسط.', history: contents.slice(-40) };
}

/** رسالة خطأ مفهومة */
export function explainError(e: unknown): string {
  if (e instanceof GeminiError) {
    if (e.status === 0) return 'لا يوجد اتصال بالإنترنت.';
    if (e.status === 429) return 'انتهى الحد المجاني المسموح الآن من Google — انتظر دقيقة، أو حتى الغد إن كان الحد اليومي.';
    if (e.status === 400 && /API key/i.test(e.message)) return 'مفتاح Gemini غير صحيح — غيّره من زر المفتاح.';
    if (e.status === 403) return 'المفتاح لا يملك صلاحية، أو الخدمة غير متاحة في بلدك.';
    return `خطأ من Google (${e.status}): ${e.message}`;
  }
  if (e instanceof Anthropic.AuthenticationError) return 'مفتاح API غير صحيح — غيّره من زر المفتاح.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'المفتاح لا يملك صلاحية لهذا النموذج.';
  if (e instanceof Anthropic.RateLimitError) return 'طلبات كثيرة أو رصيد غير كافٍ — حاول بعد قليل.';
  if (e instanceof Anthropic.BadRequestError) return 'طلب غير مقبول: ' + e.message;
  if (e instanceof Anthropic.APIConnectionError) return 'لا يوجد اتصال بالإنترنت.';
  if (e instanceof Anthropic.APIError) return `خطأ من الخادم (${e.status}): ${e.message}`;
  return String((e as Error)?.message || e);
}
