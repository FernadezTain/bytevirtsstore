import { supabaseAdmin, requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    const user = await requireAdmin(req);
    if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

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
  } catch (e) {
    console.error('Необработанная ошибка в /api/admin/promocodes:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
