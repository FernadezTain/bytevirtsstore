import { supabaseAdmin, requireUser } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });

    const { code, context, amount } = req.body;
    if (!code || !context) return res.status(400).json({ error: 'Укажите промокод' });
    if (!['discount', 'bonus'].includes(context)) return res.status(400).json({ error: 'Некорректный контекст' });

    const { data: promo, error } = await supabaseAdmin
      .from('promo_codes').select('*').eq('code', String(code).trim().toUpperCase()).maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!promo || !promo.is_active) return res.status(404).json({ error: 'Промокод не найден' });
    if (promo.type !== context) {
      return res.status(400).json({
        error: context === 'discount'
          ? 'Этот промокод не для оплаты, а для пополнения баланса'
          : 'Этот промокод не для пополнения, а для оплаты покупок'
      });
    }
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(400).json({ error: 'Срок действия промокода истёк' });
    if (promo.max_activations != null && promo.activations_count >= promo.max_activations) {
      return res.status(400).json({ error: 'Лимит активаций промокода исчерпан' });
    }

    const { data: used } = await supabaseAdmin
      .from('promo_code_uses').select('id').eq('promo_id', promo.id).eq('user_id', user.id).maybeSingle();
    if (used) return res.status(400).json({ error: 'Вы уже использовали этот промокод' });

    const base = Number(amount) || 0;
    if (promo.min_amount && base < promo.min_amount) {
      return res.status(400).json({ error: `Минимальная сумма для этого промокода — ${promo.min_amount} ₽` });
    }

    let applied = promo.value_type === 'amount'
      ? Number(promo.value)
      : Math.round(base * Number(promo.value) / 100 * 100) / 100;

    if (context === 'discount') {
      applied = Math.min(applied, base);

      // Скидка применяется сразу — оплата с баланса происходит мгновенно, без отдельного шага подтверждения.
      const { error: useErr } = await supabaseAdmin.from('promo_code_uses').insert({
        promo_id: promo.id, user_id: user.id, context: 'discount', base_amount: base, applied_value: applied
      });
      if (useErr) return res.status(400).json({ error: 'Вы уже использовали этот промокод' });

      await supabaseAdmin.from('promo_codes')
        .update({ activations_count: promo.activations_count + 1 }).eq('id', promo.id);
    }

    return res.status(200).json({
      ok: true,
      code: promo.code,
      value_type: promo.value_type,
      value: promo.value,
      applied
    });
  } catch (e) {
    console.error('Необработанная ошибка в /api/promo/check:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
