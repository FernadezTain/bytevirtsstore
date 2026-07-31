import { supabaseAdmin, requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    const user = await requireAdmin(req);
    if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

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
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).end();
  } catch (e) {
    console.error('Необработанная ошибка в /api/admin/accounts:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
