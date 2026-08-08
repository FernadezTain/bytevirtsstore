import { supabaseAdmin, requireUser } from '../_admin.js';

async function isAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    const admin = await isAdmin(user.id);

    if (req.method === 'GET') {
      const ticketId = req.query.ticket_id;
      if (!ticketId) return res.status(400).json({ error: 'Не указан ticket_id' });

      const { data: ticket, error: tErr } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId).single();
      if (tErr || !ticket) return res.status(404).json({ error: 'Обращение не найдено' });
      if (!admin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Нет доступа к этому обращению' });

      const { data: profile } = await supabaseAdmin.from('profiles').select('username').eq('id', ticket.user_id).single();
      ticket.username = profile?.username || '—';

      const { data: messages, error: mErr } = await supabaseAdmin.from('support_messages')
        .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
      if (mErr) return res.status(500).json({ error: mErr.message });

      return res.status(200).json({ ticket, messages: messages || [] });
    }

    if (req.method === 'POST') {
      const { ticket_id, body } = req.body;
      if (!ticket_id || !body || !body.trim()) return res.status(400).json({ error: 'Введите сообщение' });

      const { data: ticket, error: tErr } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticket_id).single();
      if (tErr || !ticket) return res.status(404).json({ error: 'Обращение не найдено' });
      if (!admin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Нет доступа к этому обращению' });
      if (ticket.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто, отправка сообщений недоступна' });

      const { data: msg, error: mErr } = await supabaseAdmin.from('support_messages').insert({
        ticket_id, sender_id: user.id, sender_role: admin ? 'admin' : 'user', body: body.trim()
      }).select().single();
      if (mErr) return res.status(500).json({ error: mErr.message });

      const nextStatus = admin && ticket.status === 'new' ? 'active' : ticket.status;
      await supabaseAdmin.from('support_tickets')
        .update({ status: nextStatus, updated_at: new Date().toISOString() })
        .eq('id', ticket_id);

      return res.status(200).json(msg);
    }

    return res.status(405).end();
  } catch (e) {
    console.error('Необработанная ошибка в /api/support/messages:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
