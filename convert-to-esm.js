#!/usr/bin/env node
/**
 * Automated CommonJS to ESM Converter - Full Repo Scanner
 * Run: node convert-to-esm.js [--dry-run] [--backup]
 */

import { readdirSync, readFileSync, writeFileSync, statSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CREATE_BACKUP = args.includes('--backup');

const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'cache',
  'artifacts',
  'typechain-types',
  'coverage',
  '.github',
  'logs',
  'data',
  'archive'
];

const INCLUDED_EXTENSIONS = ['.js', '.ts', '.mjs', '.cjs'];

const COMMONJS_PATTERNS = [
  // require() statements - various forms
  { 
    name: 'require (default)',
    regex: /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\);?/g, 
    replacement: "import $1 from '$2';" 
  },
  { 
    name: 'require (destructured)',
    regex: /const\s*{\s*([^}]+)\s*}\s*=\s*require\(['"]([^'"]+)['"]\);?/g, 
    replacement: "import { $1 } from '$2';" 
  },
  { 
    name: 'require (property access)',
    regex: /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)\.(\w+);?/g, 
    replacement: "import { $3 as $1 } from '$2';" 
  },
  { 
    name: 'require (no const)',
    regex: /require\(['"]([^'"]+)['"]\);?/g, 
    replacement: "import '$1';" 
  },
  
  // module.exports
  { 
    name: 'module.exports (default)',
    regex: /module\.exports\s*=\s*(\w+);?/g, 
    replacement: "export default $1;" 
  },
  { 
    name: 'module.exports (object)',
    regex: /module\.exports\s*=\s*{\s*([^}]+)\s*};?/g, 
    replacement: "export { $1 };" 
  },
  
  // exports.x = y
  { 
    name: 'exports.name',
    regex: /exports\.(\w+)\s*=\s*(\w+);?/g, 
    replacement: "export { $2 as $1 };" 
  },
  
  // __filename and __dirname
  { 
    name: '__filename',
    regex: /__filename/g, 
    replacement: "fileURLToPath(import.meta.url)" 
  },
  { 
    name: '__dirname',
    regex: /\b__dirname\b/g, 
    replacement: "dirname(fileURLToPath(import.meta.url))" 
  },
  
  // require.main === module
  { 
    name: 'require.main',
    regex: /if\s*\(\s*require\.main\s*===\s*module\s*\)/g, 
    replacement: "const isMainModule = import.meta.url === `file://${process.argv[1]}`; if (isMainModule)" 
  },
];

const REQUIRED_ESM_IMPORTS = {
  __dirname: "import { dirname } from 'path';",
  __filename: "import { fileURLToPath } from 'url';",
};

function findFiles(dir, files = [], baseDir = dir) {
  const items = readdirSync(dir, { withFileTypes: true });
  
  for (const item of items) {
    const fullPath = join(dir, item.name);
    const relPath = fullPath.replace(baseDir + '/', '');
    
    if (item.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(item.name) && !item.name.startsWith('.')) {
        findFiles(fullPath, files, baseDir);
      }
    } else if (item.isFile()) {
      const ext = extname(item.name);
      if (INCLUDED_EXTENSIONS.includes(ext)) {
        files.push({ fullPath, relPath, ext });
      }
    }
  }
  
  return files;
}

function needsConversion(content) {
  // Check for any CommonJS patterns
  for (const pattern of COMMONJS_PATTERNS) {
    if (pattern.regex.test(content)) {
      pattern.regex.lastIndex = 0; // Reset regex
      return true;
    }
    pattern.regex.lastIndex = 0; // Reset regex
  }
  return false;
}

function convertFile(filePath, relPath) {
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  const changes = [];
  let modified = false;
  
  // Track what needs to be imported
  const neededImports = new Set();
  
  // Apply conversions
  for (const pattern of COMMONJS_PATTERNS) {
    const matches = [...content.matchAll(pattern.regex)];
    if (matches.length > 0) {
      content = content.replace(pattern.regex, pattern.replacement);
      changes.push(`${pattern.name} (${matches.length} occurrences)`);
      modified = true;
      
      // Track needed imports
      if (pattern.name === '__dirname') neededImports.add('__dirname');
      if (pattern.name === '__filename') neededImports.add('__filename');
    }
    pattern.regex.lastIndex = 0; // Reset
  }
  
  // Add necessary imports if __dirname or __filename is used
  if (neededImports.size > 0) {
    const lines = content.split('\n');
    let lastImportIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportIndex = i;
      }
    }
    
    const importsToAdd = [];
    for (const imp of neededImports) {
      const importLine = REQUIRED_ESM_IMPORTS[imp];
      if (!content.includes(importLine)) {
        importsToAdd.push(importLine);
      }
    }
    
    if (importsToAdd.length > 0) {
      if (lastImportIndex >= 0) {
        lines.splice(lastImportIndex + 1, 0, ...importsToAdd);
      } else {
        lines.unshift(...importsToAdd, '');
      }
      content = lines.join('\n');
      changes.push(`Added imports: ${importsToAdd.join(', ')}`);
    }
  }
  
  // Create backup if requested
  if (modified && CREATE_BACKUP && !DRY_RUN) {
    const backupDir = join(__dirname, '.esm-backups');
    const backupPath = join(backupDir, relPath + '.backup');
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(filePath, backupPath);
  }
  
  // Write changes
  if (modified && !DRY_RUN) {
    writeFileSync(filePath, content);
  }
  
  return {
    modified,
    changes,
    originalContent: DRY_RUN ? originalContent : null
  };
}

// Main execution
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║     CommonJS to ESM Converter - Full Repository Scan       ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

if (DRY_RUN) {
  console.log('🔍 DRY RUN MODE - No files will be modified\n');
}

if (CREATE_BACKUP) {
  console.log('💾 BACKUP MODE - Original files will be saved to .esm-backups/\n');
}

console.log('📁 Scanning repository...\n');

const files = findFiles(__dirname);
console.log(`Found ${files.length} JavaScript/TypeScript files\n`);

const results = {
  converted: [],
  alreadyESM: [],
  needsAttention: [],
  errors: []
};

for (const { fullPath, relPath, ext } of files) {
  try {
    const content = readFileSync(fullPath, 'utf8');
    
    // Skip if already ESM (has imports, no requires)
    const hasRequire = content.includes('require(');
    const hasModuleExports = content.includes('module.exports') || content.includes('exports.');
    const hasImport = content.includes('import ');
    
    if (!hasRequire && !hasModuleExports) {
      if (hasImport) {
        results.alreadyESM.push({ file: relPath, reason: 'Already ESM' });
      } else {
        results.alreadyESM.push({ file: relPath, reason: 'No CommonJS patterns' });
      }
      continue;
    }
    
    // Check if needs conversion
    if (!needsConversion(content)) {
      results.alreadyESM.push({ file: relPath, reason: 'No conversion patterns found' });
      continue;
    }
    
    // Convert the file
    const result = convertFile(fullPath, relPath);
    
    if (result.modified) {
      results.converted.push({
        file: relPath,
        changes: result.changes
      });
      
      const status = DRY_RUN ? 'Would convert' : '✅ Converted';
      console.log(`${status}: ${relPath}`);
      result.changes.forEach(c => console.log(`   └─ ${c}`));
    } else {
      results.needsAttention.push({ file: relPath, reason: 'Unknown patterns' });
    }
    
  } catch (error) {
    results.errors.push({ file: relPath, error: error.message });
    console.error(`❌ Error processing ${relPath}: ${error.message}`);
  }
}

// Summary
console.log('\n' + '═'.repeat(60));
console.log('📊 SUMMARY');
console.log('═'.repeat(60));

console.log(`\n✅ Converted: ${results.converted.length}`);
if (results.converted.length > 0) {
  console.log('   Files:');
  results.converted.forEach(r => console.log(`   • ${r.file}`));
}

console.log(`\n⏭️  Already ESM/No changes: ${results.alreadyESM.length}`);
if (results.alreadyESM.length > 0) {
  const sample = results.alreadyESM.slice(0, 5);
  sample.forEach(r => console.log(`   • ${r.file} (${r.reason})`));
  if (results.alreadyESM.length > 5) {
    console.log(`   ... and ${results.alreadyESM.length - 5} more`);
  }
}

console.log(`\n⚠️  Needs manual attention: ${results.needsAttention.length}`);
if (results.needsAttention.length > 0) {
  results.needsAttention.forEach(r => console.log(`   • ${r.file} - ${r.reason}`));
}

console.log(`\n❌ Errors: ${results.errors.length}`);
if (results.errors.length > 0) {
  results.errors.forEach(r => console.log(`   • ${r.file}: ${r.error}`));
}

// Save report
const reportPath = join(__dirname, 'esm-conversion-report.json');
writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`\n📝 Detailed report saved to: ${reportPath}`);

if (DRY_RUN) {
  console.log('\n💡 This was a dry run. To actually convert files, run:');
  console.log('   node convert-to-esm.js');
} else if (CREATE_BACKUP) {
  console.log('\n💾 Backups saved to .esm-backups/');
}

console.log('\n✨ Done!');
