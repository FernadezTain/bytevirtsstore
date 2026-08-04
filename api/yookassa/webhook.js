import { supabaseAdmin, applyBonusPromo } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();

    const update = req.body || {};
    if (update.event !== 'payment.succeeded') {
      return res.status(200).json({ ok: true });
    }

    const payment = update.object;
    const paymentId = payment?.id;
    if (!paymentId) return res.status(200).json({ ok: true });

    // Не доверяем телу запроса напрямую — перезапрашиваем платёж у ЮKassa по id,
    // чтобы исключить поддельные уведомления от кого попало.
    const shopId = process.env.YOOKASSA_SHOP_ID;
    const secretKey = process.env.YOOKASSA_SECRET_KEY;
    const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');

    const verifyRes = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { 'Authorization': `Basic ${auth}` }
    });
    const verified = await verifyRes.json().catch(() => ({}));

    if (!verifyRes.ok || verified.status !== 'succeeded') {
      console.error('YooKassa webhook: платёж не подтверждён при проверке', verified);
      return res.status(200).json({ ok: true });
    }

    const userId = verified.metadata?.supabase_user_id;
    const baseRub = Number(verified.amount?.value);
    const promoCode = verified.metadata?.promo_code || null;
    if (!userId || !Number.isFinite(baseRub)) {
      console.error('YooKassa webhook: нет supabase_user_id или суммы', verified);
      return res.status(200).json({ ok: true });
    }

    // Идемпотентность: не зачисляем дважды один и тот же payment_id
    const { data: existing } = await supabaseAdmin
      .from('yookassa_payments').select('id').eq('payment_id', paymentId).maybeSingle();

    if (!existing) {
      const bonusRub = await applyBonusPromo(userId, promoCode, baseRub);
      const totalRub = baseRub + bonusRub;

      const { error: insertErr } = await supabaseAdmin.from('yookassa_payments').insert({
        user_id: userId,
        payment_id: paymentId,
        amount: totalRub,
        promo_code: bonusRub ? promoCode : null,
        bonus_rub: bonusRub
      });

      if (insertErr) {
        console.error('Ошибка записи yookassa_payments:', insertErr);
      } else {
        const { error: rpcErr } = await supabaseAdmin.rpc('increment_balance', {
          p_user_id: userId,
          p_amount: totalRub
        });
        if (rpcErr) console.error('Ошибка зачисления баланса:', rpcErr);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('Необработанная ошибка в /api/yookassa/webhook:', e);
    return res.status(200).json({ ok: false });
  }
}
