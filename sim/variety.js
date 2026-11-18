// Насколько разные получаются жизни. Запуск: node sim/variety.js [число жизней]
// 1) Повторы у одного игрока: он всегда вводит один и тот же год рождения и играет 10 жизней подряд.
// 2) Похожесть сюжетов: путь жизни (учёба, переезды, семья, работа, заграница, возраст смерти).
// 3) Самые частые фразы.
const { loadContent } = require('./simulate');
const { liveLife } = require('./engine');

const content = loadContent();
const N = Number(process.argv.find((a) => /^\d+$/.test(a)) || 5000);
const msgs = (life) => life.days.flatMap((d) => d.messages).filter((m) => m.id && !['birth', 'final'].includes(m.type));

// --- 1. Игрок с фиксированным годом рождения играет 10 жизней подряд ---
const PLAYERS = Math.floor(N / 10);
const MEMORY = process.argv.includes('--memory');
const ANY_YEAR = process.argv.includes('--any-year'); // игрок каждый раз вводит новый год
const repeatAt = Array(10).fill(0); const totalAt = Array(10).fill(0);
const forkRepeatAt = Array(10).fill(0); const forkTotalAt = Array(10).fill(0);
for (let p = 0; p < PLAYERS; p++) {
  const year = 1980 + (p % 41);
  const seen = new Set(); const seenForks = new Set();
  for (let k = 0; k < 10; k++) {
    const y = ANY_YEAR ? 1980 + ((p * 7 + k * 13) % 41) : year;
    const life = liveLife(content, { birthYear: y, seed: 100000 + p * 10 + k, seenBefore: MEMORY ? seen : undefined });
    for (const m of msgs(life)) {
      if (m.type === 'fork') { forkTotalAt[k]++; if (seenForks.has(m.id)) forkRepeatAt[k]++; }
      else { totalAt[k]++; if (seen.has(m.id)) repeatAt[k]++; }
    }
    for (const m of msgs(life)) (m.type === 'fork' ? seenForks : seen).add(m.id);
  }
}

// --- 2 и 3. Сюжеты и частота фраз на N жизнях ---
const sig = {}; const freq = {}; const sets = [];
const deathBucket = (a) => (a < 50 ? 'до 50' : a < 65 ? '50–64' : a < 80 ? '65–79' : '80+');
for (let i = 0; i < N; i++) {
  const life = liveLife(content, { birthYear: 1980 + (i % 41), seed: 500000 + i });
  const h = life.hero;
  const f = (x) => h.flags.includes(x);
  const age = Math.floor((h.deathDate - (h.birthYear * 12 + h.birthMonth)) / 12);
  const s = [
    f('uni') ? 'вуз' : f('college') ? 'колледж' : f('after_army') ? 'армия' : 'без учёбы',
    h.cities.length > 2 ? 'много переездов' : h.cities.length === 2 ? 'один переезд' : 'всю жизнь в одном месте',
    f('settled_abroad') ? 'остался за границей' : f('returned') ? 'вернулся из-за границы' : '',
    f('married') || f('widowed') ? 'брак' : h.spouse ? 'пара без штампа' : f('ever_divorced') ? 'развод' : 'один',
    `детей: ${h.kids.length}`,
    f('own_business') ? 'своё дело' : f('it_job') ? 'айти' : f('budget_job') ? 'бюджет' : f('worker') ? 'рабочий' : 'офис',
    deathBucket(age),
  ].filter(Boolean).join(' · ');
  sig[s] = (sig[s] || 0) + 1;
  const ids = new Set(msgs(life).filter((m) => m.type !== 'fork').map((m) => m.id));
  for (const id of ids) freq[id] = (freq[id] || 0) + 1;
  if (i < 2000) sets.push(ids);
}

// Похожесть двух случайных жизней одного года рождения: доля общих событий (Жаккар).
let jSum = 0; let jMax = 0; let pairs = 0;
for (let i = 0; i < sets.length; i++) {
  for (let j = i + 41; j < sets.length; j += 41) { // тот же год рождения
    const a = sets[i]; const b = sets[j];
    let inter = 0; for (const x of a) if (b.has(x)) inter++;
    const jac = inter / (a.size + b.size - inter);
    jSum += jac; jMax = Math.max(jMax, jac); pairs++;
  }
}

const pct = (a, b) => `${((100 * a) / b).toFixed(0)}%`;
console.log(`\n=== 1. Один игрок, 10 жизней подряд (${PLAYERS} игроков)${MEMORY ? ', бот помнит прочитанное' : ''}${ANY_YEAR ? ', каждый раз новый год рождения' : ', год рождения один и тот же'} ===`);
for (let k = 0; k < 10; k++) console.log(`Жизнь ${k + 1}: уже встречавшихся событий ${pct(repeatAt[k], totalAt[k])}, развилок ${pct(forkRepeatAt[k], forkTotalAt[k])}`);

console.log(`\n=== 2. Похожесть жизней (${N} жизней) ===`);
console.log(`Две случайные жизни одного года рождения делят в среднем ${pct(jSum, pairs)} событий, максимум ${pct(jMax, 1)}.`);
const sigs = Object.entries(sig).sort((a, b) => b[1] - a[1]);
console.log(`Разных сюжетов (путь жизни): ${sigs.length} на ${N} жизней.`);
const pSame = sigs.reduce((s, [, c]) => s + (c / N) ** 2, 0);
console.log(`Шанс, что две случайные жизни пойдут по одному сюжету: ${(100 * pSame).toFixed(1)}%.`);
console.log('Самые частые сюжеты:');
sigs.slice(0, 8).forEach(([s, c]) => console.log(`  ${pct(c, N)} — ${s}`));

console.log('\n=== 3. Самые частые события (в скольких жизнях встречаются) ===');
const byId = Object.fromEntries(content.events.map((e) => [e.id, e]));
Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([id, c]) => {
  const e = byId[id];
  console.log(`  ${pct(c, N)} ${e?.must ? '[обязательное] ' : ''}${(e?.text || id).slice(0, 90)}`);
});
const buckets = { '50%+': 0, '25–50%': 0, '10–25%': 0, '<10%': 0 };
for (const c of Object.values(freq)) { const r = c / N; buckets[r >= 0.5 ? '50%+' : r >= 0.25 ? '25–50%' : r >= 0.1 ? '10–25%' : '<10%']++; }
console.log('Распределение событий по частоте:', Object.entries(buckets).map(([k, v]) => `${k}: ${v}`).join(', '));
