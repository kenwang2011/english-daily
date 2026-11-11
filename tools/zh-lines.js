/* 用 app.js 自己的逻辑枚举要预录的句子，输出 { 指纹: 送读文本 } 的 JSON。
   用法：node zh-lines.js [allZhLines|allSpellLines|allEnLines]，默认中文句子。
   这样合成脚本和播放端算出的指纹永远一致，不用维护两份规则。 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const noop = () => {};
const ctx = { console, setTimeout, setInterval: noop, clearTimeout, localStorage: { getItem: () => null, setItem: noop },
  document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null },
  location: { search: '', hash: '' }, navigator: {} };
ctx.window = ctx;
vm.createContext(ctx);
['data/g3.js', 'data/g4.js', 'data/g5.js', 'data/g6.js', 'data/guide.js', 'data/tips.js', 'data/tips-g3.js', 'data/tips-g4.js', 'data/tips-g5.js', 'words.js', 'app.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
process.stdout.write(vm.runInContext('DB = loadDB(); JSON.stringify(' + (['allSpellLines', 'allEnLines'].indexOf(process.argv[2]) >= 0 ? process.argv[2] : 'allZhLines') + '())', ctx));
