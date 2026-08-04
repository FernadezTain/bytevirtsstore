import { requireUser } from '../_admin.js';

const MIN_STARS = 1;
const RUB_PER_STAR = 2;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();

    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });

    const stars = Math.floor(Number(req.body?.stars));
    if (!Number.isFinite(stars) || stars < MIN_STARS) {
      return res.status(400).json({ error: `Минимум ${MIN_STARS} Star` });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN не настроен' });

    const rub = stars * RUB_PER_STAR;
    const promoCode = req.body?.promo_code ? String(req.body.promo_code).trim().toUpperCase() : null;
    const payload = JSON.stringify({ supabase_user_id: user.id, stars, promo_code: promoCode });

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
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
  } catch (e) {
    console.error('Необработанная ошибка в /api/telegram/create-invoice:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
