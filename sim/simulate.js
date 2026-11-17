#!/usr/bin/env node
// Симулятор жизни. Два режима:
//   node sim/simulate.js --year 1995 --seed 42   — одна жизнь в samples/ для чтения
//   node sim/simulate.js --check 5000            — прогнать много жизней и найти ошибки

const fs = require('fs');
const path = require('path');
const { liveLife, DAYS } = require('./engine');

const ROOT = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadContent() {
  const dir = (d) => fs.readdirSync(path.join(ROOT, 'content', d)).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(ROOT, 'content', d, f)));
  const events = []; const forks = []; const fills = {};
  for (const file of dir('events')) { events.push(...file.events); Object.assign(fills, file.fills || {}); }
  for (const file of dir('forks')) forks.push(...file.forks);
  return {
    regions: readJson(path.join(ROOT, 'content/world/regions.json')).regions,
    names: readJson(path.join(ROOT, 'content/world/names.json')),
    start: readJson(path.join(ROOT, 'content/world/start.json')),
    events, forks, fills,
  };
}

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : def;
}

function toMarkdown(life) {
  const h = life.hero;
  const lines = [`# ${h.name}, ${h.birthYear} · ${h.birthCity.name} (${h.region.id})`, '',
    `Пол: ${h.gender === 'm' ? 'мужской' : 'женский'} · Семья: ${h.wealth} · Родители: ${h.parents} · Брат/сестра: ${h.sib} · Характер: ${h.trait} · Имена семьи: ${h.familyPool}`, ''];
  for (const d of life.days) {
    lines.push(`## День ${d.day}`, '');
    for (const m of d.messages) {
      if (m.type === 'fork') {
        lines.push(`**${m.clock}** · ${m.label} · 🔀 **Развилка:** ${m.text}`);
        lines.push(`> Кнопки: ${m.options.join(' / ')}`);
        lines.push(`> Выбрано: ${m.chosen}`);
        lines.push(`> ${m.result}`, '');
      } else {
        lines.push(`**${m.clock}** · ${m.label} · ${m.text}`, '');
      }
    }
  }
  lines.push(`---`, `Итоговые параметры: ${JSON.stringify(h.stats)} · Флаги: ${h.flags.join(', ') || 'нет'}`);
  return lines.join('\n');
}

function check(content, runs) {
  const problems = [];
  const seen = new Map(content.events.map((e) => [e.id, 0]));
  const forkSeen = new Map(content.forks.map((f) => [f.id, 0]));
  const counts = [];
  const ids = new Set();
  let quiet = 0;
  // Запретные слова и темы (см. research/russia.md, раздел «Политика и религия»).
  const FORBIDDEN = /войн|путин|сво\b|мобилиз|санкци|президент|депутат|митинг|протест|выборы|крым|донбасс|украин/i;
  for (const e of [...content.events, ...content.forks]) {
    const texts = [e.text, ...(e.options || []).flatMap((o) => [o.label, o.result])];
    for (const t of texts) if (FORBIDDEN.test(t)) problems.push(`Запретная тема в ${e.id}: ${t}`);
    // Частая ошибка в формах рода: «смеялся{|ась}» даёт «смеялсяась».
    for (const t of texts) if (t && /ся\{\||сь\{\|/.test(t)) problems.push(`Ошибка формы рода в ${e.id}: ${t}`);
  }
  for (const [k, list] of Object.entries(content.fills)) for (const t of list) if (FORBIDDEN.test(t)) problems.push(`Запретная тема в fills.${k}: ${t}`);
  for (const e of [...content.events, ...content.forks]) {
    if (ids.has(e.id)) problems.push(`Повторяющийся id: ${e.id}`);
    ids.add(e.id);
  }
  for (let i = 0; i < runs; i++) {
    const year = 1980 + (i % 33);
    const life = liveLife(content, { birthYear: year, seed: i + 1 });
    let last = null;
    for (const d of life.days) {
      counts.push(d.messages.length);
      // Каждый год жизни должен встретиться хотя бы в одном сообщении.
      const plan = DAYS.find((p) => p.day === d.day);
      const seenAges = new Set(d.messages.map((m) => {
        const tail = m.label.split(' · ')[1] || '';
        return tail === 'рождение' || tail === 'до года' ? 0 : parseInt(tail, 10);
      }));
      for (let y = plan.ages[0]; y <= plan.ages[1]; y++) {
        if (!seenAges.has(y)) problems.push(`Пропущен год ${y} (день ${d.day}, жизнь ${i + 1})`);
      }
      if (d.messages.some((m) => m.type !== 'birth' && !/ · (до года|\d+ (год|года|лет))$/.test(m.label))) problems.push(`Нет возраста в подписи (жизнь ${i + 1})`);
      if (d.messages.filter((m) => m.type !== 'fork').length > 8) problems.push(`Больше 8 сообщений в день (день ${d.day}, жизнь ${i + 1})`);
      for (const m of d.messages) {
        const [mn, yr] = m.label.split(' ');
        const t = Number(yr) * 12 + ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'].indexOf(mn);
        if (last !== null && t < last) problems.push(`Нарушен порядок дат (${m.id || m.type}, жизнь ${i + 1}): ${m.label}`);
        last = t;
        const all = [m.text, m.result || ''].join(' ');
        if (/[{}]/.test(all)) problems.push(`Незаполненная переменная (${m.id || m.type}, жизнь ${i + 1}): ${all}`);
        if (/  |\s[.,]/.test(all)) problems.push(`Лишний пробел (${m.id}, жизнь ${i + 1}): ${all}`);
        if (m.type === 'event') { if (seen.has(m.id)) seen.set(m.id, seen.get(m.id) + 1); else quiet++; }
        if (m.type === 'fork') forkSeen.set(m.id, forkSeen.get(m.id) + 1);
      }
    }
  }
  // Проверка распределений: пол, регионы, имена.
  const g = { m: 0, f: 0 }; const reg = {}; const nm = {}; const pools = {};
  for (let i = 0; i < runs; i++) {
    const h = liveLife(content, { birthYear: 1980 + (i % 33), seed: 100000 + i }).hero;
    g[h.gender]++; reg[h.region.id] = (reg[h.region.id] || 0) + 1; nm[h.name] = (nm[h.name] || 0) + 1;
    pools[h.familyPool] = (pools[h.familyPool] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${(100 * v / runs).toFixed(1)}%`).join(', ');
  console.log(`Мальчиков: ${(100 * g.m / runs).toFixed(1)}%`);
  console.log(`Регионы: ${top(reg, 8)}`);
  console.log(`Имена: ${top(nm, 10)}`);
  console.log(`Пулы имён семей: ${top(pools, 8)}`);
  const maxAge = Math.max(...DAYS.map((d) => d.ages[1]));
  const reachable = (id) => { const e = content.events.find((x) => x.id === id); return e.age[0] <= maxAge && !(e.if && e.if.years && e.if.years[0] > 1980 + 32 + maxAge); };
  const never = [...seen].filter(([id, c]) => c === 0 && reachable(id)).map(([id]) => id);
  const later = [...seen].filter(([id]) => !reachable(id)).length;
  console.log(`Событий для взрослых лет (ждут следующих дней): ${later}`);
  const forksNever = [...forkSeen].filter(([id, c]) => c === 0 && content.forks.find((f) => f.id === id).age[0] <= maxAge).map(([id]) => id);
  const uniq = [...new Set(problems)];
  console.log(`Прожито жизней: ${runs}`);
  console.log(`Сообщений в день: от ${Math.min(...counts)} до ${Math.max(...counts)}, в среднем ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
  console.log(`Событий в базе: ${content.events.length}, развилок: ${content.forks.length}`);
  console.log(`Запасных «спокойных лет» (событий не хватило): ${quiet} на ${runs} жизней`);
  console.log(`Ни разу не выпали события: ${never.length ? never.join(', ') : 'нет'}`);
  console.log(`Ни разу не выпали развилки: ${forksNever.length ? forksNever.join(', ') : 'нет'}`);
  console.log(`Проблем: ${uniq.length}`);
  uniq.slice(0, 30).forEach((p) => console.log(' - ' + p));
  return uniq.length === 0;
}

const content = loadContent();
if (arg('check')) {
  process.exit(check(content, Number(arg('check'))) ? 0 : 1);
} else {
  const year = Number(arg('year', 1995));
  const seed = Number(arg('seed', Date.now() % 100000));
  const life = liveLife(content, { birthYear: year, seed });
  const out = path.join(ROOT, 'samples', `life-${year}-${seed}.md`);
  fs.writeFileSync(out, toMarkdown(life));
  console.log(`Жизнь записана: ${out}`);
}
