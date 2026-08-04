import { supabaseAdmin, requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    const user = await requireAdmin(req);
    if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });
    if (req.method !== 'GET') return res.status(405).end();

    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Не указан id промокода' });

    const { data: promo, error: promoErr } = await supabaseAdmin
      .from('promo_codes').select('*').eq('id', id).single();
    if (promoErr || !promo) return res.status(404).json({ error: 'Промокод не найден' });

    const { data: usesRaw, error: usesErr } = await supabaseAdmin
      .from('promo_code_uses').select('*').eq('promo_id', id).order('created_at', { ascending: true });
    if (usesErr) return res.status(500).json({ error: usesErr.message });

    const uses = usesRaw || [];
    const totalUses = uses.length;
    const totalBase = uses.reduce((s, u) => s + Number(u.base_amount || 0), 0);
    const totalApplied = uses.reduce((s, u) => s + Number(u.applied_value || 0), 0);
    const uniqueUsers = new Set(uses.map(u => u.user_id)).size;
    const lastUsedAt = uses.length ? uses[uses.length - 1].created_at : null;
    const avgApplied = totalUses ? totalApplied / totalUses : 0;

    // Группировка активаций по дням для графика
    const byDay = {};
    for (const u of uses) {
      const day = String(u.created_at || '').slice(0, 10);
      if (!day) continue;
      byDay[day] = (byDay[day] || 0) + 1;
    }
    const daily = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    return res.status(200).json({
      promo,
      totalUses,
      totalBase,
      totalApplied,
      uniqueUsers,
      lastUsedAt,
      avgApplied,
      daily
    });
  } catch (e) {
    console.error('Необработанная ошибка в /api/admin/promo-stats:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
