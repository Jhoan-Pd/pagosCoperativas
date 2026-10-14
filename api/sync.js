export default function handler(req, res) {
  let n = 0;
  req.on('data', (c) => { n += c.length; });
  req.on('end', () => res.status(200).json({ ok: true, bytes: n, hora: new Date().toISOString() }));
}
