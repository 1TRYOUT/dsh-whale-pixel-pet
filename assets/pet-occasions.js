/**
 * 鲸鱼娘 · 场合判定（纯函数）
 * ---------------------------------------------------------------------------
 * 92 张立绘里有 40 多张一直闲置（festival-* / daily-* / night / valentine）。
 * 这一层只做一件事：**给定时间和她的状态，判断现在该不该用某张特殊立绘**。
 *
 * 刻意做成纯函数：传进一个 Date、传进状态，返回一个结论，不碰 DOM、不碰计时器。
 * 于是"圣诞节当天会换图""深夜会穿睡衣""连干两小时会伸懒腰"都能用单测钉死。
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  'use strict';
  var API = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = API;
  if (typeof root === 'object' && root) root.WhalePetOccasions = API;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 公历节日（月-日）。这些日期万年不变，放心用。 */
  var SOLAR = {
    '01-01': { hint: 'festivalNewYear', line: '新年快乐！今年也一起加油吧', tag: 'newyear' },
    '02-14': { hint: 'valentine', line: '今、今天是情人节…（递过来一颗糖）', tag: 'valentine' },
    '10-31': { hint: 'festivalHalloween', line: '不给糖就捣蛋！', tag: 'halloween' },
    '12-24': { hint: 'festivalChristmas', line: '平安夜～我挂了袜子哦', tag: 'christmas' },
    '12-25': { hint: 'festivalChristmas', line: '圣诞快乐！', tag: 'christmas' }
  };

  /**
   * 农历节日（需要逐年核对，只列已确认的年份）。
   * 没列到的年份会**安静地不触发**——宁可不过节，也不要过错节。
   */
  var LUNAR = {
    '2025-01-29': { hint: 'festivalSpring', line: '春节快乐！红包…可以吗？', tag: 'spring' },
    '2026-02-17': { hint: 'festivalSpring', line: '春节快乐！红包…可以吗？', tag: 'spring' },
    '2025-10-06': { hint: 'festivalMidAutumn', line: '中秋快乐～月亮好圆', tag: 'midautumn' },
    '2026-09-25': { hint: 'festivalMidAutumn', line: '中秋快乐～月亮好圆', tag: 'midautumn' }
  };

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function md(date) { return pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function ymd(date) { return date.getFullYear() + '-' + md(date); }

  /**
   * 判断此刻的场合。
   * @param {Date} date
   * @param {object} state  { workedMinutes?: number } 连续工作了多久
   * @returns {{hint:string, line:string, tag:string, kind:string}|null}
   */
  function pick(date, state) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return null;
    state = state || {};

    // 1) 节日优先：一年就这么几天，值得盖过作息
    var lunar = LUNAR[ymd(date)];
    if (lunar) return Object.assign({ kind: 'festival' }, lunar);
    var solar = SOLAR[md(date)];
    if (solar) return Object.assign({ kind: 'festival' }, solar);

    var hour = date.getHours();

    // 2) 熬夜：23:00–04:00 换成夜猫子/睡衣
    if (hour >= 23 || hour < 4) {
      return {
        hint: date.getMinutes() % 2 === 0 ? 'night' : 'pajama',
        line: hour >= 23 ? '这么晚还不睡…我陪你' : '（揉眼睛）你也熬夜啊',
        tag: 'late-night', kind: 'routine'
      };
    }

    // 3) 早起第一杯：06:00–08:30
    if (hour >= 6 && hour < 9) {
      return { hint: 'dailyCoffee', line: '早安～先喝口热的', tag: 'morning', kind: 'routine' };
    }

    // 4) 连续工作太久：提醒站起来走走
    if (typeof state.workedMinutes === 'number' && state.workedMinutes >= 120) {
      return {
        hint: 'dailyStretch',
        line: '已经连续忙了 ' + Math.floor(state.workedMinutes / 60) + ' 小时，站起来走走？',
        tag: 'long-work', kind: 'health'
      };
    }

    return null;
  }

  /** 场合的"有效期"：同一种场合多久之内不必重复触发 */
  function cooldownMs(kind) {
    if (kind === 'festival') return 12 * 60 * 60 * 1000;   // 节日一天提一次就够
    if (kind === 'health') return 60 * 60 * 1000;
    return 3 * 60 * 60 * 1000;                              // 作息类
  }

  return { SOLAR: SOLAR, LUNAR: LUNAR, pick: pick, cooldownMs: cooldownMs, _md: md, _ymd: ymd };
});
