import { supabaseAdmin } from '../_admin.js';

const RUB_PER_STAR = 2;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();

    // Защита: Telegram присылает секрет, заданный при setWebhook(secret_token=...)
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return res.status(401).end();
    }

    const update = req.body || {};

    // 1. Предпроверка платежа — обязана ответить ok:true в течение 10 сек
    if (update.pre_checkout_query) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: update.pre_checkout_query.id,
          ok: true
        })
      });
      return res.status(200).json({ ok: true });
    }

    // 2. Успешная оплата
    const sp = update.message?.successful_payment;
    if (sp) {
      const chargeId = sp.telegram_payment_charge_id;
      let payload;
      try { payload = JSON.parse(sp.invoice_payload); } catch { payload = null; }

      if (!payload?.supabase_user_id || !payload?.stars) {
        console.error('Некорректный payload у successful_payment:', sp.invoice_payload);
        return res.status(200).json({ ok: true });
      }

      // Идемпотентность: не зачисляем дважды один и тот же charge_id
      const { data: existing } = await supabaseAdmin
        .from('star_payments').select('id').eq('telegram_charge_id', chargeId).maybeSingle();

      if (!existing) {
        const rub = payload.stars * RUB_PER_STAR;

        const { error: insertErr } = await supabaseAdmin.from('star_payments').insert({
          user_id: payload.supabase_user_id,
          telegram_charge_id: chargeId,
          stars: payload.stars,
          rub_amount: rub
        });

        if (insertErr) {
          console.error('Ошибка записи star_payments:', insertErr);
        } else {
          const { error: rpcErr } = await supabaseAdmin.rpc('increment_balance', {
            p_user_id: payload.supabase_user_id,
            p_amount: rub
          });
          if (rpcErr) console.error('Ошибка зачисления баланса:', rpcErr);
        }
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Необработанная ошибка в /api/telegram/webhook:', e);
    // Telegram будет ретраить не-200 ответы, поэтому лучше вернуть 200 и просто залогировать
    return res.status(200).json({ ok: false });
  }
}
