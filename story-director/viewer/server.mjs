// 故事导演 · 控制页面本地服务器
// 用法：node server.mjs [端口]   （默认 8642）
// 浏览器打开 http://localhost:8642

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');          // story-director/
const NODE_MODULES = path.resolve(ROOT, 'tools/three_bake/node_modules');
const PORT = Number(process.argv[2] || 8642);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vrm': 'model/gltf-binary',
  '.vrma': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // API：列出模型与动作
  if (url === '/api/list') {
    const models = fs.existsSync(path.join(ROOT, 'models'))
      ? fs.readdirSync(path.join(ROOT, 'models')).filter(f => f.toLowerCase().endsWith('.vrm'))
      : [];
    const actionsDir = path.join(ROOT, 'actions');
    const actions = fs.existsSync(actionsDir)
      ? fs.readdirSync(actionsDir).filter(f => f.toLowerCase().endsWith('.vrma')).map(f => f.replace(/\.vrma$/i, ''))
      : [];
    const voiceDir = path.join(ROOT, 'voice');
    const voice = fs.existsSync(voiceDir)
      ? fs.readdirSync(voiceDir).filter(f => f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.ogg'))
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ models, actions, voice }));
    return;
  }

  // 静态文件
  let rel = url === '/' ? '/viewer/index.html' : url;
  const candidates = [
    path.join(ROOT, rel),
    path.join(NODE_MODULES, url.replace('/node_modules/', '')),
    path.join(ROOT, 'tools/three_bake', rel),
  ];
  for (const file of candidates) {
    if (!file.startsWith(ROOT) && !file.startsWith(NODE_MODULES)) continue;
    if (file.startsWith(NODE_MODULES) || file.startsWith(ROOT)) {
      try {
        const data = fs.readFileSync(file);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
        res.end(data);
        return;
      } catch { /* 试下一个候选路径 */ }
    }
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404: ' + url);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`控制页面已启动: http://localhost:${PORT}`);
});
