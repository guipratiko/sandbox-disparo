/**
 * Copia arquivos .sql para dist/ após o tsc (Node não inclui .sql no outDir).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src', 'database', 'migrations');
const dstDir = path.join(root, 'dist', 'database', 'migrations');

if (!fs.existsSync(srcDir)) {
  console.warn('copy-migrations: pasta src/database/migrations não encontrada, ignorando.');
  process.exit(0);
}

fs.mkdirSync(dstDir, { recursive: true });
for (const f of fs.readdirSync(srcDir)) {
  if (f.endsWith('.sql')) {
    fs.copyFileSync(path.join(srcDir, f), path.join(dstDir, f));
  }
}
console.log('✅ Migrations SQL copiadas para dist/database/migrations');
