import { supabaseAdmin, requireUser, applyBonusPromo } from '../../lib/_admin.js';
import crypto from 'crypto';

const MIN_RUB = 10;

export default async function handler(req, res) {
  try {
    const slugArr = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    const route = slugArr[0];

    if (route === 'create-payment') return handleCreatePayment(req, res);
    if (route === 'webhook') return handleWebhook(req, res);

    return res.status(404).json({ error: 'Маршрут не найден' });
  } catch (e) {
    console.error('Необработанная ошибка в /api/yookassa:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}

/* ---------- Создание платежа ---------- */
async function handleCreatePayment(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });

  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < MIN_RUB) {
    return res.status(400).json({ error: `Минимальная сумма пополнения — ${MIN_RUB} ₽` });
  }

  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  if (!shopId || !secretKey) return res.status(500).json({ error: 'ЮKassa не настроена' });

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const returnUrl = `${origin}/?topup=success`;

  const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
  const idempotenceKey = crypto.randomUUID();

  const ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Idempotence-Key': idempotenceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: { value: amount.toFixed(2), currency: 'RUB' },
      capture: true,
      confirmation: { type: 'redirect', return_url: returnUrl },
      description: `Пополнение баланса ByteVirts на ${amount} ₽`,
      metadata: {
        supabase_user_id: user.id,
        promo_code: req.body?.promo_code ? String(req.body.promo_code).trim().toUpperCase() : ''
      }
    })
  });

  const ykJson = await ykRes.json().catch(() => ({}));
  if (!ykRes.ok) {
    console.error('YooKassa create payment error:', ykJson);
    return res.status(500).json({ error: ykJson.description || 'Не удалось создать платёж' });
  }

  return res.status(200).json({
    confirmation_url: ykJson.confirmation?.confirmation_url,
    payment_id: ykJson.id
  });
}

/* ---------- Вебхук ЮKassa ---------- */
async function handleWebhook(req, res) {
  if (req.method !== 'POST') return res.status(200).end();

  const update = req.body || {};
  if (update.event !== 'payment.succeeded') {
    return res.status(200).json({ ok: true });
  }

  const payment = update.object;
  const paymentId = payment?.id;
  if (!paymentId) return res.status(200).json({ ok: true });

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
        p_user_id: userId, p_amount: totalRub
      });
      if (rpcErr) console.error('Ошибка зачисления баланса:', rpcErr);
    }
  }

  return res.status(200).json({ ok: true });
}
