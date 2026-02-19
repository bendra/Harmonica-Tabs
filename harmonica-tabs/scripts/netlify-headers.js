const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');
const templatePath = path.join(__dirname, '..', '_headers.template');
const outputPath = path.join(distDir, '_headers');

if (!fs.existsSync(distDir)) {
  console.error('dist/ not found. Run the web export first.');
  process.exit(1);
}

if (!fs.existsSync(templatePath)) {
  console.error('_headers.template not found.');
  process.exit(1);
}

fs.copyFileSync(templatePath, outputPath);
console.log('Copied _headers.template to dist/_headers');
