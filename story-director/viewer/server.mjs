// 故事导演 · 控制页面本地服务器
// 用法：node server.mjs [端口]   （默认 8642）
// 浏览器打开 http://localhost:8642

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // API：读剧本文件
  if (url.startsWith('/api/read_script')) {
    // 注意：顶部的 url 变量已剥掉查询串，这里要用原始 req.url
    const q = new URL('http://x' + req.url).searchParams;
    const file = q.get('file') || 'story.json';
    const safe = path.basename(file);
    try {
      const txt = fs.readFileSync(path.join(ROOT, safe), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ text: txt }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ text: '', error: String(e) }));
    }
    return;
  }

  // API：保存剧本文件
  if (url === '/api/save_script' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const safe = path.basename(d.file || 'story_web.json');
        fs.writeFileSync(path.join(ROOT, safe), d.text, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, file: safe }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('save failed: ' + e.message);
      }
    });
    return;
  }

  // API：实时 TTS（Windows 语音合成，带缓存）
  if (url === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const text = String(d.text || '').slice(0, 300);
        const rate = Math.max(-2, Math.min(2, parseInt(d.rate || 0)));
        if (!text) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({}));
          return;
        }
        const key = crypto.createHash('md5').update(text + '|' + rate).digest('hex').slice(0, 12);
        const genDir = path.join(ROOT, 'voice', 'gen');
        fs.mkdirSync(genDir, { recursive: true });
        const wav = path.join(genDir, key + '.wav');
        if (!fs.existsSync(wav)) {
          const ps1 = path.join(genDir, key + '.ps1');
          const voice = 'Microsoft Huihui Desktop';
          const fmt = 'System.Speech.AudioFormat.SpeechAudioFormatInfo(22050,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono)';
          const q = String.fromCharCode(39);
          const escText = text.split(q).join(q + q);
          const NL = String.fromCharCode(10);
          const lines = [
            'Add-Type -AssemblyName System.Speech',
            '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
            '$s.SelectVoice(' + q + voice + q + ')',
            '$s.Rate = ' + rate,
            '$fmt = New-Object ' + fmt,
            '$s.SetOutputToWaveFile(' + q + wav + q + ', $fmt)',
            '$s.Speak(' + q + escText + q + ')',
            '$s.Dispose()',
          ];
          const BOM = String.fromCharCode(0xfeff);
          fs.writeFileSync(ps1, BOM + lines.join(NL), 'utf-8');
          execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { timeout: 30000 });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ file: key + '.wav' }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('tts err: ' + e.message);
      }
    });
    return;
  }

  // API：工作台配置（读取/保存，全部页面设置持久化到 config.json）
  if (url === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(d, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('config save failed: ' + e.message);
      }
    });
    return;
  }
  if (url === '/api/config') {
    try {
      const txt = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(txt);
    } catch {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({}));
    }
    return;
  }

  // API：列出模型与动作
  if (url === '/api/list') {
    const models = fs.existsSync(path.join(ROOT, 'models'))
      ? fs.readdirSync(path.join(ROOT, 'models')).filter(f => f.toLowerCase().endsWith('.vrm'))
      : [];
    const actionsDir = path.join(ROOT, 'actions');
    const actions = fs.existsSync(actionsDir)
      ? fs.readdirSync(actionsDir).filter(f => f.toLowerCase().endsWith('.vrma')).map(f => f.replace(/\.vrma$/i, ''))
      : [];
    const scenesDir = path.join(ROOT, 'scenes');
    const scenes = fs.existsSync(scenesDir)
      ? fs.readdirSync(scenesDir).filter(f => f.toLowerCase().endsWith('.glb'))
      : [];
    const voiceDir = path.join(ROOT, 'voice');
    const voice = fs.existsSync(voiceDir)
      ? fs.readdirSync(voiceDir).filter(f => f.toLowerCase().endsWith('.wav') || f.toLowerCase().endsWith('.ogg'))
      : [];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ models, actions, voice, scenes }));
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
