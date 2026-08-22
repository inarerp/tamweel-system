#!/usr/bin/env node
/**
 * 🗺️ Tamweel System — Dependency Analyzer
 * 
 * سكريبت لتحليل الاعتماديات في المشروع باستخدام Madge
 * يُنتج:
 *   - dependency-graph.png (صورة بصرية)
 *   - dependencies.json (بيانات قابلة للتحليل)
 *   - circular-deps.txt (Circular Dependencies)
 * 
 * طريقة الاستخدام:
 *   1. npm install -g madge
 *   2. node scripts/analyze-dependencies.js
 * 
 * ملاحظة: هذا السكريبت يكتشف الاعتماديات الصريحة (imports/exports).
 *          للاعتماديات الضمنية (Global Functions, window.*)،
 *          راجع PROJECT_DEPENDENCY_MAP.md يدوياً.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// التحقق من تثبيت Madge
try {
  execSync('madge --version', { stdio: 'ignore' });
} catch (e) {
  console.error('❌ Madge غير مثبت. ثبته بأمر:');
  console.error('   npm install -g madge');
  process.exit(1);
}

const jsDir = path.join(__dirname, '..', 'js');
const outputDir = path.join(__dirname, 'output');

// إنشاء مجلد الإخراج
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('🗺️  بدء تحليل الاعتماديات...\n');

// 1. توليد Dependency Graph كصورة
console.log('📊 توليد Dependency Graph...');
try {
  execSync(`madge --image ${outputDir}/dependency-graph.png ${jsDir}`, { 
    stdio: 'inherit' 
  });
  console.log(`✅ تم حفظ الصورة في: ${outputDir}/dependency-graph.png\n`);
} catch (e) {
  console.error('❌ فشل توليد الصورة');
}

// 2. تصدير JSON للتحليل
console.log('📄 تصدير dependencies.json...');
try {
  const jsonOutput = execSync(`madge --json ${jsDir}`, { encoding: 'utf-8' });
  fs.writeFileSync(
    path.join(outputDir, 'dependencies.json'),
    jsonOutput,
    'utf-8'
  );
  console.log(`✅ تم حفظ JSON في: ${outputDir}/dependencies.json\n`);
} catch (e) {
  console.error('❌ فشل تصدير JSON');
}

// 3. اكتشاف Circular Dependencies
console.log('🔄 اكتشاف Circular Dependencies...');
try {
  const circularOutput = execSync(`madge --circular ${jsDir}`, { encoding: 'utf-8' });
  fs.writeFileSync(
    path.join(outputDir, 'circular-deps.txt'),
    circularOutput,
    'utf-8'
  );
  console.log(`✅ تم حفظ Circular Dependencies في: ${outputDir}/circular-deps.txt\n`);
  
  if (circularOutput.trim()) {
    console.log('⚠️  تم اكتشاف Circular Dependencies:');
    console.log(circularOutput);
  } else {
    console.log('✅ لا توجد Circular Dependencies\n');
  }
} catch (e) {
  console.error('❌ فشل اكتشاف Circular Dependencies');
}

// 4. تحليل Global Functions (custom analysis)
console.log('🌐 تحليل Global Functions و window.* exports...');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
const globals = {};

files.forEach(file => {
  const content = fs.readFileSync(path.join(jsDir, file), 'utf-8');
  
  // البحث عن window.X = 
  const windowExports = content.match(/window\.(\w+)\s*=/g) || [];
  windowExports.forEach(exp => {
    const name = exp.replace('window.', '').replace('=', '').trim();
    if (!globals[name]) globals[name] = [];
    globals[name].push({ file, type: 'window-export' });
  });
  
  // البحث عن var X = (global variables)
  const varExports = content.match(/^var\s+(\w+)\s*=/gm) || [];
  varExports.forEach(exp => {
    const name = exp.replace('var ', '').replace('=', '').trim();
    if (!globals[name]) globals[name] = [];
    globals[name].push({ file, type: 'global-var' });
  });
  
  // البحث عن function X( (global functions)
  const funcExports = content.match(/^function\s+(\w+)\s*\(/gm) || [];
  funcExports.forEach(exp => {
    const name = exp.replace('function ', '').replace('(', '').trim();
    if (!globals[name]) globals[name] = [];
    globals[name].push({ file, type: 'global-function' });
  });
});

fs.writeFileSync(
  path.join(outputDir, 'globals-analysis.json'),
  JSON.stringify(globals, null, 2),
  'utf-8'
);
console.log(`✅ تم حفظ Global Analysis في: ${outputDir}/globals-analysis.json\n`);

// 5. تحليل Database Tables
console.log('🗄️  تحليل Database Tables...');
const dbUsage = {};

files.forEach(file => {
  const content = fs.readFileSync(path.join(jsDir, file), 'utf-8');
  const tables = content.match(/\.from\(['"](\w+)['"]\)/g) || [];
  tables.forEach(t => {
    const tableName = t.replace('.from(', '').replace(/['"]/g, '').replace(')', '');
    if (!dbUsage[tableName]) dbUsage[tableName] = [];
    if (!dbUsage[tableName].includes(file)) {
      dbUsage[tableName].push(file);
    }
  });
});

fs.writeFileSync(
  path.join(outputDir, 'db-usage.json'),
  JSON.stringify(dbUsage, null, 2),
  'utf-8'
);
console.log(`✅ تم حفظ DB Usage في: ${outputDir}/db-usage.json\n`);

console.log('🎉 انتهى التحليل!');
console.log(`📁 الملفات الناتجة في: ${outputDir}/`);
console.log('   - dependency-graph.png');
console.log('   - dependencies.json');
console.log('   - circular-deps.txt');
console.log('   - globals-analysis.json');
console.log('   - db-usage.json');
