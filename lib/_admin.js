import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function requireAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin' ? user : null;
}

export async function requireUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Применяет бонусный промокод к пополнению баланса (вызывается из вебхуков оплаты).
// Возвращает сумму бонуса в рублях (0, если промокод не подходит/уже использован/условие не выполнено).
export async function applyBonusPromo(userId, code, baseRub) {
  if (!code || !userId) return 0;
  try {
    const { data: promo } = await supabaseAdmin
      .from('promo_codes').select('*').eq('code', String(code).trim().toUpperCase()).maybeSingle();

    if (!promo || !promo.is_active || promo.type !== 'bonus') return 0;
    if (promo.expires_at && new Date(promo.expires_at) < new Date()) return 0;
    if (promo.max_activations != null && promo.activations_count >= promo.max_activations) return 0;
    if (promo.min_amount && baseRub < promo.min_amount) return 0;

    const { data: used } = await supabaseAdmin
      .from('promo_code_uses').select('id').eq('promo_id', promo.id).eq('user_id', userId).maybeSingle();
    if (used) return 0;

    const bonus = promo.value_type === 'amount'
      ? Number(promo.value)
      : Math.round(baseRub * Number(promo.value) / 100 * 100) / 100;

    const { error: useErr } = await supabaseAdmin.from('promo_code_uses').insert({
      promo_id: promo.id, user_id: userId, context: 'bonus', base_amount: baseRub, applied_value: bonus
    });
    if (useErr) return 0; // уже использован (гонка) — просто не начисляем бонус повторно

    await supabaseAdmin.from('promo_codes')
      .update({ activations_count: promo.activations_count + 1 }).eq('id', promo.id);

    return bonus;
  } catch (e) {
    console.error('Ошибка применения бонусного промокода:', e);
    return 0;
  }
}
