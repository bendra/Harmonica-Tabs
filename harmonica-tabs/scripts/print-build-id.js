const { execSync } = require('child_process');

function read(command, fallback) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

const sha = read('git rev-parse --short HEAD', 'nogit');
const dirty = read('git status --short', '') ? 'dirty' : 'clean';
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

process.stdout.write(`${sha}-${dirty}-${timestamp}`);
