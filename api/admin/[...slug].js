import { supabaseAdmin, requireAdmin } from '../../lib/_admin.js';

export default async function handler(req, res) {
  try {
    const user = await requireAdmin(req);
    if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

    const slugArr = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
    const route = slugArr[0];

    if (route === 'accounts') return handleAccounts(req, res);
    if (route === 'servers') return handleServers(req, res);
    if (route === 'promocodes') return handlePromocodes(req, res);
    if (route === 'promo-stats') return handlePromoStats(req, res);

    return res.status(404).json({ error: 'Маршрут не найден' });
  } catch (e) {
    console.error('Необработанная ошибка в /api/admin:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}

/* ---------- Товары ---------- */
async function handleAccounts(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('accounts').select('*, server:servers(id, name)').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { title, server_id, level, price, tags, is_verified, status, photos, description, secret_info } = req.body;
    const { data, error } = await supabaseAdmin.from('accounts')
      .insert({ title, server_id, level, price, tags, is_verified, status: status || 'active', photos, description, secret_info })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { id, ...fields } = req.body;
    const { data, error } = await supabaseAdmin.from('accounts')
      .update(fields).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const { error } = await supabaseAdmin.from('accounts').delete().eq('id', id);
    if (error) {
      if (error.code === '23503') {
        // Товар уже кто-то купил — есть строки в purchases, ссылающиеся на него.
        // Удалить нельзя, не потеряв историю сделки, поэтому архивируем (скрываем из каталога).
        const { error: archiveErr } = await supabaseAdmin
          .from('accounts')
          .update({ status: 'sold' })
          .eq('id', id);
        if (archiveErr) return res.status(500).json({ error: archiveErr.message });
        return res.status(200).json({ ok: true, archived: true });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}

/* ---------- Сервера ---------- */
async function handleServers(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin.from('servers').select('*').order('sort_order');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { name, slug, sort_order = 0 } = req.body;
    const { data, error } = await supabaseAdmin.from('servers')
      .insert({ name, slug, sort_order }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { id, name, slug, sort_order } = req.body;
    const { data, error } = await supabaseAdmin.from('servers')
      .update({ name, slug, sort_order }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const { error } = await supabaseAdmin.from('servers').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}

/* ---------- Промокоды ---------- */
async function handlePromocodes(req, res) {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('promo_codes').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { code, type, value_type, value, min_amount, max_activations, expires_at } = req.body;
    if (!code || !type || !value_type || !value) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (!['discount', 'bonus'].includes(type)) return res.status(400).json({ error: 'Некорректный тип промокода' });
    if (!['amount', 'percent'].includes(value_type)) return res.status(400).json({ error: 'Некорректный тип значения' });
    if (value_type === 'percent' && (Number(value) < 1 || Number(value) > 100)) {
      return res.status(400).json({ error: 'Процент должен быть от 1 до 100' });
    }

    const { data, error } = await supabaseAdmin.from('promo_codes')
      .insert({
        code: String(code).trim().toUpperCase(),
        type,
        value_type,
        value: Number(value),
        min_amount: type === 'bonus' ? (Number(min_amount) || 0) : 0,
        max_activations: max_activations ? Number(max_activations) : null,
        expires_at: expires_at || null
      })
      .select().single();

    if (error) {
      return res.status(500).json({ error: error.code === '23505' ? 'Такой промокод уже существует' : error.message });
    }
    return res.status(200).json(data);
  }

  if (req.method === 'PUT') {
    const { id, is_active } = req.body;
    const { data, error } = await supabaseAdmin.from('promo_codes')
      .update({ is_active }).eq('id', id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.body;
    const { error } = await supabaseAdmin.from('promo_codes').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}

/* ---------- Статистика промокода ---------- */
async function handlePromoStats(req, res) {
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

  const byDay = {};
  for (const u of uses) {
    const day = String(u.created_at || '').slice(0, 10);
    if (!day) continue;
    byDay[day] = (byDay[day] || 0) + 1;
  }
  const daily = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  return res.status(200).json({ promo, totalUses, totalBase, totalApplied, uniqueUsers, lastUsedAt, avgApplied, daily });
}
