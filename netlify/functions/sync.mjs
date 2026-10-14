export default async (req) => {
  const cuerpo = req.method === 'POST' ? await req.text() : '';
  return new Response(JSON.stringify({ ok: true, bytes: cuerpo.length, hora: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json' },
  });
};

export const config = { path: '/api/sync' };
