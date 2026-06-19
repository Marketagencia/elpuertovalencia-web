const http = require('http');
const https = require('https');
const url = require('url');
const qs = require('querystring');

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const ORIGIN = (process.env.ORIGINS || 'https://elpuertovalencia.com').split(',')[0].trim();
const PORT = process.env.PORT || 3000;
const HOST = process.env.OAUTH_HOST || 'oauth.elpuertovalencia.com';

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/auth') {
    const params = qs.stringify({
      client_id: CLIENT_ID,
      scope: 'repo,user'
    });
    res.writeHead(302, { Location: `https://github.com/login/oauth/authorize?${params}` });
    res.end();

  } else if (parsed.pathname === '/callback') {
    const code = parsed.query.code;
    if (!code) { res.writeHead(400); res.end('Missing code'); return; }

    const body = JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code });
    const opts = {
      hostname: 'github.com',
      path: '/login/oauth/access_token',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const ghReq = https.request(opts, ghRes => {
      let data = '';
      ghRes.on('data', c => data += c);
      ghRes.on('end', () => {
        try {
          const { access_token } = JSON.parse(data);
          const html = `<!DOCTYPE html><html><body><script>
            (function(){
              var token = ${JSON.stringify(access_token)};
              var msg = 'authorization:github:success:' + JSON.stringify({token: token, provider: 'github'});
              if (window.opener) {
                window.opener.postMessage(msg, '*');
              } else {
                window.location = ${JSON.stringify(ORIGIN + '/admin/')};
              }
            })();
          </script></body></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html', 'Access-Control-Allow-Origin': ORIGIN });
          res.end(html);
        } catch(e) {
          res.writeHead(500); res.end('Error getting token: ' + e.message);
        }
      });
    });
    ghReq.on('error', () => { res.writeHead(500); res.end('GitHub request failed'); });
    ghReq.write(body);
    ghReq.end();

  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OAuth proxy OK');
  }
});

server.listen(PORT, () => console.log(`OAuth server running on port ${PORT}`));
