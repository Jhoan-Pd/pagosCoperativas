import { generarResumen } from '../src/servicio/simulador.js';

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'GET') {
    response.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const limite = Number(request.query?.limite ?? '1200');
    const resumen = await generarResumen({ limite });
    response.status(200).json(resumen);
  } catch (error) {
    response.status(500).json({ ok: false, error: error?.message ?? 'Unexpected error' });
  }
}
