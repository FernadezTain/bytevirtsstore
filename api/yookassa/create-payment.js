import { requireUser } from '../_admin.js';
import crypto from 'crypto';

const MIN_RUB = 10;

export default async function handler(req, res) {
  try {
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
  } catch (e) {
    console.error('Необработанная ошибка в /api/yookassa/create-payment:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
