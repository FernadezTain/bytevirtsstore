import { requireAdmin, supabaseAdmin } from '../_admin.js';

export default async function handler(req, res) {
  try {
    if (req.method !== 'PUT') return res.status(405).end();
    const user = await requireAdmin(req);
    if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

    const { ticket_id, status } = req.body;
    if (!ticket_id || !['new', 'active', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Некорректные данные' });
    }

    const { data, error } = await supabaseAdmin.from('support_tickets')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', ticket_id).select().single();
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json(data);
  } catch (e) {
    console.error('Необработанная ошибка в /api/support/status:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
