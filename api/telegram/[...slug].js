import { supabaseAdmin, requireUser, applyBonusPromo } from '../../lib/_admin.js';

const RUB_PER_STAR = 2;
const MIN_STARS = 1;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async function handler(req, res) {
  try {
    const slugArr = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    const route = slugArr[0];

    if (route === 'create-invoice') return handleCreateInvoice(req, res);
    if (route === 'webhook') return handleWebhook(req, res);

    return res.status(404).json({ error: 'Маршрут не найден' });
  } catch (e) {
    console.error('Необработанная ошибка в /api/telegram:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}

function tg(method, body) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then((r) => r.json());
}

/* ---------- Создание счёта на Stars ---------- */
async function handleCreateInvoice(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });

  const stars = Math.floor(Number(req.body?.stars));
  if (!Number.isFinite(stars) || stars < MIN_STARS) {
    return res.status(400).json({ error: `Минимум ${MIN_STARS} Star` });
  }

  if (!BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });

  const rub = stars * RUB_PER_STAR;
  const promoCode = req.body?.promo_code ? String(req.body.promo_code).trim().toUpperCase() : null;
  const payload = JSON.stringify({ supabase_user_id: user.id, stars, promo_code: promoCode });

  const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Пополнение баланса ByteVirts',
      description: `Пополнение баланса на ${stars} ${stars === 1 ? 'Star' : 'Stars'} (${rub} ₽)`,
      payload,
      currency: 'XTR',
      prices: [{ label: 'Баланс ByteVirts', amount: stars }]
    })
  });
  const tgJson = await tgRes.json().catch(() => ({}));

  if (!tgJson.ok) {
    console.error('createInvoiceLink error:', tgJson);
    return res.status(500).json({ error: tgJson.description || 'Не удалось создать счёт Telegram' });
  }

  return res.status(200).json({ invoice_link: tgJson.result, stars, rub });
}

/* ---------- Вебхук Telegram ---------- */
const SERVICE_RULES_URL = process.env.SERVICE_RULES_URL || 'https://example.com/rules';
const PRIVACY_POLICY_URL = process.env.PRIVACY_POLICY_URL || 'https://example.com/privacy';
const PUBLIC_OFFER_URL = process.env.PUBLIC_OFFER_URL || 'https://example.com/offer';
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://bytevirts.vercel.app/';

const CONSENT_TEXT =
  '📜 Перед покупкой нужно согласиться с условиями.\nНажмите «✅ Согласен», чтобы продолжить.';
const WELCOME_TEXT = '👋 Добро пожаловать!\n\nНажмите кнопку ниже, чтобы открыть Мини-Приложение.';

function consentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📋 Правила сервиса', url: SERVICE_RULES_URL }],
      [{ text: '🔒 Политика конфиденциальности', url: PRIVACY_POLICY_URL }],
      [{ text: '📜 Публичная оферта', url: PUBLIC_OFFER_URL }],
      [{ text: '✅ Согласен', callback_data: 'agree' }]
    ]
  };
}
function welcomeKeyboard() {
  return { inline_keyboard: [[{ text: '🚀 Мини-Приложение', web_app: { url: MINI_APP_URL } }]] };
}

async function hasAgreed(telegramUserId) {
  const { data } = await supabaseAdmin
    .from('telegram_bot_users').select('agreed').eq('telegram_user_id', telegramUserId).maybeSingle();
  return !!data?.agreed;
}
async function markAgreed(telegramUserId) {
  await supabaseAdmin.from('telegram_bot_users').upsert({
    telegram_user_id: telegramUserId, agreed: true, agreed_at: new Date().toISOString()
  });
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).end();
  }

  const update = req.body || {};

  if (update.message?.text === '/start') {
    const chatId = update.message.chat.id;
    const userId = update.message.from.id;

    if (await hasAgreed(userId)) {
      await tg('sendMessage', { chat_id: chatId, text: WELCOME_TEXT, reply_markup: welcomeKeyboard() });
    } else {
      await tg('sendMessage', { chat_id: chatId, text: CONSENT_TEXT, reply_markup: consentKeyboard() });
    }
    return res.status(200).json({ ok: true });
  }

  if (update.callback_query?.data === 'agree') {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const userId = cq.from.id;

    await markAgreed(userId);

    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '✅ Вы согласились со всеми условиями' });
    await tg('sendMessage', { chat_id: chatId, text: WELCOME_TEXT, reply_markup: welcomeKeyboard() });
    await tg('answerCallbackQuery', { callback_query_id: cq.id });

    return res.status(200).json({ ok: true });
  }

  if (update.pre_checkout_query) {
    await tg('answerPreCheckoutQuery', { pre_checkout_query_id: update.pre_checkout_query.id, ok: true });
    return res.status(200).json({ ok: true });
  }

  const sp = update.message?.successful_payment;
  if (sp) {
    const chargeId = sp.telegram_payment_charge_id;
    let payload;
    try { payload = JSON.parse(sp.invoice_payload); } catch { payload = null; }

    if (!payload?.supabase_user_id || !payload?.stars) {
      console.error('Некорректный payload у successful_payment:', sp.invoice_payload);
      return res.status(200).json({ ok: true });
    }

    const { data: existing } = await supabaseAdmin
      .from('star_payments').select('id').eq('telegram_charge_id', chargeId).maybeSingle();

    if (!existing) {
      const baseRub = payload.stars * RUB_PER_STAR;
      const bonusRub = await applyBonusPromo(payload.supabase_user_id, payload.promo_code, baseRub);
      const totalRub = baseRub + bonusRub;

      const { error: insertErr } = await supabaseAdmin.from('star_payments').insert({
        user_id: payload.supabase_user_id,
        telegram_charge_id: chargeId,
        stars: payload.stars,
        rub_amount: totalRub,
        promo_code: bonusRub ? payload.promo_code : null,
        bonus_rub: bonusRub
      });

      if (insertErr) {
        console.error('Ошибка записи star_payments:', insertErr);
      } else {
        const { error: rpcErr } = await supabaseAdmin.rpc('increment_balance', {
          p_user_id: payload.supabase_user_id, p_amount: totalRub
        });
        if (rpcErr) console.error('Ошибка зачисления баланса:', rpcErr);
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(200).json({ ok: true });
}
