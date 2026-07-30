import { supabaseAdmin, requireAdmin } from '../_admin.js';

export default async function handler(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

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
