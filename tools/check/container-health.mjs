// Use Node's HTTP client so the runtime image needs no curl or shell probe.
import http from 'node:http';

const prefix = String(process.env.BASE_PATH || '').trim().replace(/\/+$/, '');
const request = http.get({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  path: `${prefix}/api/health`,
  timeout: 4000,
}, (response) => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) response.destroy(new Error('Health response too large'));
  });
  response.on('error', fail);
  response.on('end', () => {
    try {
      if (response.statusCode !== 200 || JSON.parse(body).ok !== true) {
        throw new Error(`Unhealthy HTTP response: ${response.statusCode}`);
      }
    } catch (error) { fail(error); }
  });
});
request.on('timeout', () => request.destroy(new Error('Health request timed out')));
request.on('error', fail);

function fail(error) {
  console.error(error.message);
  process.exitCode = 1;
}
