import http from 'node:http';
const index = process.argv.indexOf('--port'), port = Number(index >= 0 ? process.argv[index + 1] : process.env.PORT || 8101);
const nameIndex = process.argv.indexOf('--id'), id = nameIndex >= 0 ? process.argv[nameIndex + 1] : process.env.BACKEND_ID || 'backend-a';
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[a-zA-Z0-9_-]{1,32}$/.test(id)) throw new Error('Invalid demo backend configuration');
const server = http.createServer(async (request, response) => {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 65536) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
  const body = JSON.stringify({ service: id, synthetic: true, status: 'ok', method: request.method, bodyBytes: length, message: request.url === '/health' ? 'Backend is healthy' : 'Synthetic demo request served' });
  response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : body);
});
server.listen(port, '0.0.0.0', () => console.log(`Synthetic ${id} listening on ${port}`));
const stop = () => server.close(() => process.exit()); process.on('SIGINT', stop); process.on('SIGTERM', stop);
