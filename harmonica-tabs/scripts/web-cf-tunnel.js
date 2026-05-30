#!/usr/bin/env node
// Runs `expo start --web` and a cloudflared quick tunnel in parallel.
// Scans cloudflared's output for the public https URL and re-prints it in a
// banner so it's easy to spot without scrolling back through Metro logs.

const { spawn, execSync } = require('child_process');

const PORT = 8081;

const buildId = execSync('node ./scripts/print-build-id.js', { encoding: 'utf8' }).trim();

const expo = spawn('npx', ['expo', 'start', '--web'], {
  env: { ...process.env, EXPO_PUBLIC_BUILD_ID: buildId },
  stdio: 'inherit',
});

// Pipe cloudflared's stdout/stderr so we can scan for the trycloudflare URL,
// then re-emit each chunk unchanged.
const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['inherit', 'pipe', 'pipe'],
});

cf.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\n[web:cf-tunnel] cloudflared not found. Install with: brew install cloudflared\n');
  } else {
    console.error(`\n[web:cf-tunnel] cloudflared failed: ${err.message}\n`);
  }
  if (expo.exitCode === null) expo.kill('SIGTERM');
  process.exit(1);
});

let tunnelUrl = null;
// Keep a small rolling buffer in case the URL line spans two chunks.
let buffer = '';
const scan = (chunk) => {
  process.stdout.write(chunk);
  if (tunnelUrl) return;
  buffer = (buffer + chunk.toString()).slice(-8192);
  const match = buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match) {
    tunnelUrl = match[0];
    const bar = '='.repeat(tunnelUrl.length + 6);
    process.stdout.write(`\n\x1b[32m${bar}\n   ${tunnelUrl}\n${bar}\x1b[0m\n\n`);
  }
};
cf.stdout.on('data', scan);
cf.stderr.on('data', scan);

// If either process exits, take the other down so the npm script returns
// instead of hanging on a half-dead pair.
const killAll = () => {
  if (expo.exitCode === null) expo.kill('SIGTERM');
  if (cf.exitCode === null) cf.kill('SIGTERM');
};
expo.on('exit', killAll);
cf.on('exit', killAll);
