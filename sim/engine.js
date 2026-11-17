// Движок жизни: по файлам из content/ проживает жизнь героя и возвращает
// список сообщений по дням. Без зависимостей, чтобы потом этот же код
// переехал в бота на Cloudflare без изменений.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Дни жизни и возраст, который они покрывают. У каждого года — минимум одно
// сообщение, поэтому в день помещается не больше 6–7 лет. Пока написан только
// контент детства, остальные дни добавятся вместе с контентом.
const DAYS = [
  { day: 1, ages: [0, 5] },
  { day: 2, ages: [6, 11] },
  { day: 3, ages: [12, 17] },
];

function ageWord(n) {
  if (n === 0) return 'до года';
  const d = n % 10; const h = n % 100;
  if (d === 1 && h !== 11) return `${n} год`;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return `${n} года`;
  return `${n} лет`;
}

// Окно отправки: с 9:00 до 20:00. Утро до 12, день до 17, вечер до 20.
const PERIOD = (minutes) => (minutes < 12 * 60 ? 'm' : minutes < 17 * 60 ? 'd' : 'e');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
function pickWeighted(r, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of entries) { x -= w; if (x <= 0) return v; }
  return entries[entries.length - 1][0];
}
const clamp = (v) => Math.max(0, Math.min(100, v));

// Пул имён семьи: русские имена года рождения или национальные (по доле в регионе).
function pickPool(r, region) {
  return pickWeighted(r, Object.entries(region.names));
}

function pickName(r, content, pool, gender, birthYear, avoid = []) {
  let entries;
  if (pool === 'ru') {
    const y = String(Math.min(2012, Math.max(1980, birthYear)));
    entries = Object.entries(content.names.ru[y][gender]);
  } else {
    const period = birthYear < 2000 ? 'old' : 'new';
    entries = content.names.ethnic[pool][period][gender].map((n) => [n, 1]);
  }
  entries = entries.filter(([n]) => !avoid.includes(n));
  return pickWeighted(r, entries);
}

// Место рождения: регион по числу родившихся в этом году, внутри региона —
// город по населению или сельская местность.
function pickBirthplace(r, content, birthYear) {
  const y = String(Math.min(2012, Math.max(1980, birthYear)));
  const region = pickWeighted(r, content.regions.map((g) => [g, g.births[y]]));
  const options = region.cities.map((c) => [{ ...c, region: region.id }, c.pop]);
  if (region.rural_weight > 0) options.push([{ rural: true }, region.rural_weight]);
  const place = pickWeighted(r, options);
  if (!place.rural) return { region, city: place };
  if (region.towns.length && r() < 0.35) {
    const t = pickWeighted(r, region.towns.map((x) => [x, x.pop]));
    return { region, city: { name: `посёлок ${t.name}`, in: `в посёлке ${t.name}`, type: 'village', region: region.id } };
  }
  return { region, city: { name: `${region.village_word.replace('в ', '')} ${region.in}`, in: `${region.village_word} ${region.in}`, type: 'village', region: region.id } };
}

function createHero(content, { birthYear, seed }) {
  const r = rng(seed);
  const start = content.start;
  const { region, city } = pickBirthplace(r, content, birthYear);
  const gender = r() < 0.514 ? 'm' : 'f'; // 105–106 мальчиков на 100 девочек
  const familyPool = pickPool(r, region);
  const name = pickName(r, content, familyPool, gender, birthYear);
  const wealth = pickWeighted(r, Object.entries(start.wealth).map(([k, v]) => [k, v.weight]));
  const parents = pickWeighted(r, Object.entries(start.parents).map(([k, v]) => [k, v.weight]));
  const sib = pickWeighted(r, Object.entries(start.siblings).map(([k, v]) => [k, v.weight]));
  const trait = pickWeighted(r, Object.entries(start.traits).map(([k, v]) => [k, v.weight]));
  const sibGender = r() < 0.514 ? 'm' : 'f';
  // Брат или сестра — из той же семьи, поэтому имя из того же пула.
  const sibling = sib === 'none' ? null : {
    gender: sibGender,
    name: pickName(r, content, familyPool, sibGender, birthYear + (sib === 'younger' ? 3 : -3), [name]),
  };
  // Друзья и первая любовь — из окружения, их пул выбирается отдельно.
  const friendName = pickName(r, content, pickPool(r, region), gender, birthYear, [name, sibling?.name]);
  const crushGender = gender === 'm' ? 'f' : 'm';
  return {
    seed, birthYear, birthMonth: Math.floor(r() * 12), gender, name,
    region, birthCity: city, city, wealth, parents, sib, trait, familyPool,
    sibling,
    friend: { gender, name: friendName },
    crush: { gender: crushGender, name: pickName(r, content, pickPool(r, region), crushGender, birthYear) },
    stats: { ...start.stats_start, money: wealth === 'low' ? 30 : wealth === 'high' ? 75 : 50 },
    flags: [],
    used: new Set(),
    r,
  };
}

// Подстановка переменных в текст.
function render(text, hero, content) {
  const g = hero.gender;
  const forms = (spec, gender) => { const [m, f] = spec.split('|'); return gender === 'm' ? m : (f ?? ''); };
  return text
    .replace(/\{s:([^}]*)\}/g, (_, spec) => forms(spec, hero.sibling?.gender ?? 'm'))
    .replace(/\{fr:([^}]*)\}/g, (_, spec) => forms(spec, hero.friend.gender))
    .replace(/\{([^{}:]*\|[^{}]*)\}/g, (_, spec) => forms(spec, g))
    .replace(/\{name\}/g, hero.name)
    .replace(/\{in\}/g, hero.city.in)
    .replace(/\{to\}/g, hero.city.to || hero.city.in)
    .replace(/\{city\}/g, hero.city.name)
    .replace(/\{friend\}/g, hero.friend.name)
    .replace(/\{crush\}/g, hero.crush.name)
    .replace(/\{sib\}/g, hero.sibling?.name ?? '')
    .replace(/\{(\w+)\}/g, (m, key) => {
      const list = content.fills[key];
      return list ? pick(hero.r, list) : m;
    });
}

function conditionsMet(cond, hero, year) {
  if (!cond) return true;
  if (cond.years && (year < cond.years[0] || year > cond.years[1])) return false;
  if (cond.city && !cond.city.includes(hero.city.type)) return false;
  if (cond.wealth && !cond.wealth.includes(hero.wealth)) return false;
  if (cond.parents && cond.parents !== hero.parents) return false;
  if (cond.sib && !cond.sib.includes(hero.sib)) return false;
  if (cond.trait && !cond.trait.includes(hero.trait)) return false;
  if (cond.gender && cond.gender !== hero.gender) return false;
  if (cond.flags && !cond.flags.every((f) => hero.flags.includes(f))) return false;
  if (cond.not && cond.not.some((f) => hero.flags.includes(f))) return false;
  return true;
}

function applyFx(fx, hero, content) {
  if (!fx) return;
  for (const k of ['health', 'happy', 'social', 'study', 'money']) {
    if (fx[k]) hero.stats[k] = clamp(hero.stats[k] + fx[k]);
  }
  for (const f of fx.flags || []) if (!hero.flags.includes(f)) hero.flags.push(f);
  if (fx.move) {
    const all = content.regions.flatMap((g) => g.cities.map((c) => ({ ...c, region: g.id })));
    if (fx.move === 'big') {
      const options = all.filter((c) => ['capital', 'million'].includes(c.type) && c.name !== hero.city.name);
      hero.city = pickWeighted(hero.r, options.map((c) => [c, c.pop]));
    } else if (fx.move === 'other_capital') {
      hero.city = all.find((c) => c.type === 'capital' && c.name !== hero.city.name);
    }
  }
}

function dateLabel(hero, ageFloat) {
  const months = hero.birthMonth + Math.floor(ageFloat * 12);
  return { year: hero.birthYear + Math.floor(months / 12), month: months % 12 };
}

function clockTimes(r, n) {
  // n моментов между 9:00 и 20:00 по возрастанию, с небольшим разбросом.
  const span = 11 * 60;
  const step = span / n;
  return Array.from({ length: n }, (_, i) => Math.round(9 * 60 + step * i + r() * step * 0.8));
}

function birthMessage(hero, content) {
  const t = content.start.traits[hero.trait];
  const parts = [
    `${hero.city.in} ${hero.gender === 'm' ? 'родился мальчик' : 'родилась девочка'}. Имя — ${hero.name}.`,
    `Семья ${content.start.wealth[hero.wealth].label}${hero.parents === 'mom' ? ', мама растит одна' : ': мама и папа'}.`,
  ];
  if (hero.sib === 'older') parts.push(`Есть ${hero.sibling.gender === 'm' ? 'старший брат' : 'старшая сестра'} ${hero.sibling.name}.`);
  parts.push(`Через пару лет станет ясно: ${hero.gender === 'm' ? t.label_m : t.label_f}.`);
  const text = parts.join(' ');
  return text[0].toUpperCase() + text.slice(1);
}

function liveDay(hero, content, dayPlan, { chooseFork } = {}) {
  const r = hero.r;
  const [a0, a1] = dayPlan.ages;
  const out = [];
  const birthAbs = hero.birthYear * 12 + hero.birthMonth;
  const ageAt = (d) => Math.floor((d - birthAbs) / 12);
  if (hero.lastDate === undefined) hero.lastDate = birthAbs;

  // Развилка дня: большая, если её возраст попадает в день, иначе одна маленькая.
  const inDay = (f) => f.age[0] <= a1 && f.age[1] >= a0;
  const big = content.forks.find((f) => f.kind === 'big' && inDay(f));
  const smalls = content.forks.filter((f) => f.kind !== 'big' && inDay(f));
  const fork = big || (smalls.length ? pickWeighted(r, smalls.map((f) => [f, f.weight || 1])) : null);

  // Слоты: по одному на каждый год дня, плюс 0–2 лишних, всего событий от 5 до 8.
  const slots = [];
  let years = [];
  for (let y = a0; y <= a1; y++) years.push(y);
  // Конец школы привязан к календарю: последний звонок в мае, выпускной в июне, выбор в июле.
  if (big && big.id === 'fk_after_school') {
    const G = hero.birthYear + 17 + (hero.birthMonth > 4 ? 1 : 0);
    years = years.filter((y) => y < 17);
    slots.push({ date: G * 12 + 4, fixed: true }, { date: G * 12 + 5, fixed: true }, { date: G * 12 + 6, fixed: true, fork: true });
  }
  const counts = Object.fromEntries(years.map((y) => [y, 1]));
  const fixedEvents = slots.filter((x) => !x.fork).length;
  const total = Math.min(8, Math.max(5, years.length + fixedEvents + Math.floor(r() * 3)));
  const extraYears = years.filter((y) => !(dayPlan.day === 1 && y === 0)); // год 0 занят рождением
  for (let k = years.length + fixedEvents; k < total; k++) counts[pick(r, extraYears)]++;
  for (const y of years) {
    const months = [];
    while (months.length < counts[y]) { const m = Math.floor(r() * 12); if (!months.includes(m)) months.push(m); }
    months.sort((a, b) => a - b).forEach((m) => slots.push({ date: birthAbs + y * 12 + m, year: y }));
  }
  if (dayPlan.day === 1) {
    const first = slots.find((x) => x.year === 0);
    first.birth = true; first.date = birthAbs;
  }
  if (fork && !big) {
    const ys = years.filter((y) => y >= fork.age[0] && y <= fork.age[1]);
    const y = ys.length ? pick(r, ys) : years[years.length - 1];
    slots.push({ date: birthAbs + y * 12 + Math.floor(r() * 12), year: y, fork: true });
  }
  slots.sort((a, b) => a.date - b.date || (a.fork ? 1 : 0) - (b.fork ? 1 : 0));
  const times = clockTimes(r, slots.length);

  const labelOf = (d) => `${MONTHS[d % 12]} ${Math.floor(d / 12)} · ${ageWord(ageAt(d))}`;

  // Куда во времени можно поставить событие: внутри своего года жизни и не раньше
  // предыдущего сообщения. Сезонные события ищут свой месяц в этом окне.
  const place = (e, i) => {
    const slot = slots[i];
    let lo; let hi;
    if (slot.fixed) { lo = slot.date; hi = slot.date; } else {
      const ys = birthAbs + slot.year * 12;
      lo = Math.max(hero.lastDate, ys);
      const next = slots.slice(i + 1).find((x) => !x.fork);
      hi = Math.min(ys + 11, next ? next.date : ys + 11);
    }
    if (lo > hi) return null;
    const ok = (d) => {
      const age = ageAt(d);
      return age >= e.age[0] && age <= e.age[1] && conditionsMet(e.if, hero, Math.floor(d / 12));
    };
    if (!e.months) { const d = Math.max(slot.date, lo); return d <= hi && ok(d) ? d : null; }
    let best = null;
    for (let d = lo; d <= hi; d++) {
      if (e.months.includes((d % 12) + 1) && ok(d) && (best === null || Math.abs(d - slot.date) < Math.abs(best - slot.date))) best = d;
    }
    return best;
  };

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const clock = `${String(Math.floor(times[i] / 60)).padStart(2, '0')}:${String(times[i] % 60).padStart(2, '0')}`;

    if (slot.birth) {
      out.push({ clock, label: `${MONTHS[hero.birthMonth]} ${hero.birthYear} · рождение`, text: birthMessage(hero, content), type: 'birth' });
      continue;
    }

    if (slot.fork) {
      const d = Math.max(slot.date, hero.lastDate);
      hero.lastDate = d;
      const options = fork.options.filter((o) => conditionsMet(o.if, hero, Math.floor(d / 12)));
      const chosenIdx = chooseFork ? chooseFork(fork, options) : Math.floor(r() * options.length);
      const chosen = options[chosenIdx];
      applyFx(chosen.fx, hero, content);
      out.push({
        clock, label: labelOf(d), type: 'fork', id: fork.id,
        text: render(fork.text, hero, content),
        options: options.map((o) => o.label),
        chosen: chosen.label,
        result: render(chosen.result, hero, content),
      });
      continue;
    }

    // Время суток — мягкое правило: событие своего времени выпадает намного чаще,
    // нейтральное («any») — чуть реже, чужое — редко, но возможно.
    const period = PERIOD(times[i]);
    const pool = [];
    for (const e of content.events) {
      if (hero.used.has(e.id)) continue;
      const d = place(e, i);
      if (d !== null) pool.push([e, d]);
    }
    let ev; let d;
    if (pool.length) {
      const timeFactor = (e) => (e.time === period ? 4 : e.time === 'any' || !e.time ? 2 : 0.3);
      // Обязательные события (рождение брата, первый класс) ставим первыми, запасные — в последнюю очередь.
      const must = pool.filter(([e]) => e.must);
      const use = must.length ? [must[0]] : pool;
      [ev, d] = pickWeighted(r, use.map((p) => [p, (p[0].weight || (p[0].filler ? 0.7 : 1)) * timeFactor(p[0])]));
      hero.used.add(ev.id);
    } else {
      // Подстраховка: год не должен пропадать, даже если подходящих событий не осталось.
      d = Math.max(slot.date, hero.lastDate);
      const key = ageAt(d) < 7 ? 'quiet_year_small' : 'quiet_year_school';
      ev = { id: key, text: pick(r, content.fills[key]) };
    }
    hero.lastDate = d;
    applyFx(ev.fx, hero, content);
    out.push({ clock, label: labelOf(d), type: 'event', id: ev.id, text: render(ev.text, hero, content), age: ageAt(d) });
  }
  return out;
}

function liveLife(content, { birthYear, seed, chooseFork }) {
  const hero = createHero(content, { birthYear, seed });
  const days = DAYS.map((plan) => ({ day: plan.day, messages: liveDay(hero, content, plan, { chooseFork }) }));
  return { hero, days };
}

module.exports = { liveLife, createHero, render, DAYS };
