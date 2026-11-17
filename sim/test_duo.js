// Проверка режима «вдвоём»: встреча есть у 100% пар, до 30 лет, в один и тот же день игры
// у обоих героев. Встречи в детстве (контент для них уже есть) проверяем по реальным сообщениям.
// Запуск: node sim/test_duo.js [число пар]
const { loadContent } = require('./simulate');
const { liveDuo, dayOfAge, DAYS } = require('./engine');

const content = loadContent();
const N = Number(process.argv[2] || 20000);
const maxWritten = Math.max(...DAYS.map((d) => d.ages[1]));
let noPlan = 0; let late = 0; let diffDay = 0; let childhood = 0; let shown = 0; let badShown = 0; let sameCity = 0;
const ages = {};
for (let i = 0; i < N; i++) {
  const year = 1980 + (i % 33);
  const duo = liveDuo(content, { birthYear: year, seedA: 2 * i + 1, seedB: 2 * i + 2 });
  const { a, b, plan } = duo;
  if (a.birthCity.name === b.birthCity.name) sameCity++;
  if (!plan) { noPlan++; continue; }
  const ageA = Math.floor((plan.date - (a.birthYear * 12 + a.birthMonth)) / 12);
  const ageB = Math.floor((plan.date - (b.birthYear * 12 + b.birthMonth)) / 12);
  ages[Math.max(ageA, ageB)] = (ages[Math.max(ageA, ageB)] || 0) + 1;
  if (ageA > 29 || ageB > 29) late++;
  if (dayOfAge(ageA) !== dayOfAge(ageB)) diffDay++;
  if (Math.max(ageA, ageB) <= maxWritten) {
    childhood++;
    const ma = duo.days.flatMap((d) => d.a.filter((m) => m.type === 'meeting').map((m) => ({ ...m, day: d.day })));
    const mb = duo.days.flatMap((d) => d.b.filter((m) => m.type === 'meeting').map((m) => ({ ...m, day: d.day })));
    const ok = ma.length === 1 && mb.length === 1 && ma[0].day === mb[0].day
      && ma[0].label.split(' · ')[0] === mb[0].label.split(' · ')[0] && !/[{}]/.test(ma[0].text + mb[0].text);
    if (ok) shown++; else { badShown++; if (badShown <= 3) console.log('Проблема:', JSON.stringify({ ma, mb })); }
  }
}
console.log(`Пар: ${N}, родились в одном городе: ${(100 * sameCity / N).toFixed(1)}%`);
console.log(`Без запланированной встречи: ${noPlan}`);
console.log(`Встреча позже 29 лет: ${late}`);
console.log(`Встреча в разные дни игры у двух друзей: ${diffDay}`);
console.log(`Встреч в детстве: ${childhood}, показаны обоим в один день: ${shown}, с ошибкой: ${badShown}`);
console.log('Возраст встречи:', Object.entries(ages).sort((x, y) => x[0] - y[0]).map(([k, v]) => `${k}: ${(100 * v / N).toFixed(1)}%`).join(', '));
const ok = noPlan === 0 && late === 0 && diffDay === 0 && badShown === 0;
console.log(ok ? 'Гарантия встречи выполняется: 100% пар встречаются до 30 лет.' : 'ЕСТЬ НАРУШЕНИЯ');
process.exit(ok ? 0 : 1);
