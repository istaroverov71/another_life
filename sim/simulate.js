#!/usr/bin/env node
// Симулятор жизни. Два режима:
//   node sim/simulate.js --year 1995 --seed 42   — одна жизнь в samples/ для чтения
//   node sim/simulate.js --check 5000            — прогнать много жизней и найти ошибки

const fs = require('fs');
const path = require('path');
const { liveLife } = require('./engine');

const ROOT = path.join(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function loadContent() {
  const dir = (d) => fs.readdirSync(path.join(ROOT, 'content', d)).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(ROOT, 'content', d, f)));
  const events = []; const forks = []; const fills = {};
  for (const file of dir('events')) { events.push(...file.events); Object.assign(fills, file.fills || {}); }
  for (const file of dir('forks')) forks.push(...file.forks);
  return {
    cities: readJson(path.join(ROOT, 'content/world/cities.json')).cities,
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
  const lines = [`# ${h.name}, ${h.birthYear} · ${h.birthCity.name}`, '',
    `Пол: ${h.gender === 'm' ? 'мужской' : 'женский'} · Семья: ${h.wealth} · Родители: ${h.parents} · Брат/сестра: ${h.sib} · Характер: ${h.trait}`, ''];
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
      for (const m of d.messages) {
        const [mn, yr] = m.label.split(' ');
        const t = Number(yr) * 12 + ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'].indexOf(mn);
        if (last !== null && t < last) problems.push(`Нарушен порядок дат (${m.id || m.type}, жизнь ${i + 1}): ${m.label}`);
        last = t;
        const all = [m.text, m.result || ''].join(' ');
        if (/[{}]/.test(all)) problems.push(`Незаполненная переменная (${m.id || m.type}, жизнь ${i + 1}): ${all}`);
        if (/  |\s[.,]/.test(all)) problems.push(`Лишний пробел (${m.id}, жизнь ${i + 1}): ${all}`);
        if (m.type === 'event') seen.set(m.id, seen.get(m.id) + 1);
        if (m.type === 'fork') forkSeen.set(m.id, forkSeen.get(m.id) + 1);
      }
    }
  }
  const never = [...seen].filter(([, c]) => c === 0).map(([id]) => id);
  const forksNever = [...forkSeen].filter(([, c]) => c === 0).map(([id]) => id);
  const uniq = [...new Set(problems)];
  console.log(`Прожито жизней: ${runs}`);
  console.log(`Сообщений в день: от ${Math.min(...counts)} до ${Math.max(...counts)}, в среднем ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);
  console.log(`Событий в базе: ${content.events.length}, развилок: ${content.forks.length}`);
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
