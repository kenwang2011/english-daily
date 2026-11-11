/* 词库汇总层
   把 data/g3.js ~ data/g6.js 的原始数据整理成统一结构：
   - window.GRADES：年级数组，每个年级含 units（按单元分组）与 words（扁平词表）
   - 每个词带 key = "g6:hello"，作为学习进度的唯一标识，避免跨年级同名词冲突
*/
(function () {
  var ORDER = ['g3', 'g4', 'g5', 'g6'];

  window.GRADES = ORDER.map(function (id) {
    var g = (window.GRADES_DATA || {})[id];
    if (!g) return null;

    var seen = {};
    var units = [];
    var flat = [];

    g.units.forEach(function (u, ui) {
      var list = [];
      u.words.forEach(function (w) {
        if (seen[w.w]) return;                 // 同一年级内同名词只保留第一次出现
        seen[w.w] = 1;
        var item = {
          w: w.w, p: w.p, cn: w.cn, ex: w.ex,
          grade: id, gradeName: g.name,
          unit: u.name, unitIndex: ui,
          key: id + ':' + w.w
        };
        list.push(item);
        flat.push(item);
      });
      if (list.length) units.push({ name: u.name, words: list });
    });

    flat.forEach(function (w, i) { w.idx = i; });

    return {
      id: id,
      name: g.name,
      short: g.short,
      units: units,
      words: flat,
      total: flat.length
    };
  }).filter(Boolean);

  window.GRADE_MAP = {};
  window.GRADES.forEach(function (g) { window.GRADE_MAP[g.id] = g; });

  /* 默认年级：六年级（与原始需求一致） */
  window.DEFAULT_GRADE = 'g6';
})();
