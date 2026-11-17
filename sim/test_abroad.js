// Проверка контента эмиграции: герой переезжает в каждый из городов и живёт там шесть лет.
// Запуск: node sim/test_abroad.js
const fs = require('fs');
const { createHero, liveDay } = require('./engine');
const R = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = (d) => fs.readdirSync(`content/${d}`).filter((f) => f.endsWith('.json')).map((f) => R(`content/${d}/${f}`));
const c = { regions: R('content/world/regions.json').regions, names: R('content/world/names.json'), start: R('content/world/start.json'), events: [], forks: [], fills: {} };
for (const f of dir('events')) { c.events.push(...f.events); Object.assign(c.fills, f.fills || {}); }
for (const f of dir('forks')) c.forks.push(...f.forks);
let bad = 0;
for (const [i, city] of ['Ереван', 'Тбилиси', 'Алматы', 'Белград', 'Стамбул'].entries()) {
  const h = createHero(c, { birthYear: 1997, seed: 11 + i });
  h.flags.push('abroad'); h.homeCity = h.city; h.city = { name: city, in: `в городе ${city}`, type: 'abroad' };
  h.lastDate = (1997 + 24) * 12 + h.birthMonth; h.abroadSince = h.lastDate;
  console.log(`\n## ${h.name}, ${city}`);
  for (const plan of [{ day: 9, ages: [25, 27] }, { day: 10, ages: [28, 30] }]) {
    for (const m of liveDay(h, c, plan)) {
      const leaked = /Икеи|Вкусно — и точка|уезжают: кто в Казахстан|QR-код|Концерт/.test(m.text) && h.flags.includes('abroad');
      if (leaked) bad++;
      console.log(`${leaked ? '❌ ' : ''}${m.label} | ${m.text}${m.type === 'fork' ? ` → ${m.chosen}` : ''}`);
    }
  }
}
console.log(`\nСобытий про Россию у героя за границей: ${bad}`);
process.exit(bad ? 1 : 0);
