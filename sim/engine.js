// Движок жизни: по файлам из content/ проживает жизнь героя и возвращает
// список сообщений по дням. Без зависимостей, чтобы потом этот же код
// переехал в бота на Cloudflare без изменений.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Дни жизни и возраст, который они покрывают. Пока написан только контент
// детства, поэтому здесь два дня. Остальные добавятся вместе с контентом.
const DAYS = [
  { day: 1, ages: [0, 8] },
  { day: 2, ages: [9, 17] },
];

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
  const n = 5 + Math.floor(r() * 4); // 5–8 сообщений
  const times = clockTimes(r, n + 1); // +1 место под развилку
  const ages = times.map((_, i) => a0 + ((a1 + 1 - a0) * (i + r() * 0.9)) / times.length);

  // Какая развилка будет сегодня и в каком слоте.
  const forksToday = content.forks.filter((f) => f.day === dayPlan.day);
  let fork = null;
  let forkSlot = -1;
  const big = forksToday.find((f) => f.kind === 'big');
  if (big) {
    // Большая развилка закрывает день. Два сообщения перед ней — уже её возраст
    // (например, выпускной перед выбором «что после школы»).
    fork = big; forkSlot = times.length - 1;
    // Остальные сообщения дня растягиваем до возраста развилки, чтобы не было провалов.
    // Для конца школы граница — май выпускного года, иначе даты пойдут не по порядку.
    let edge = big.age[0];
    if (big.id === 'fk_after_school') {
      const schoolYear = hero.birthYear + 17 + (hero.birthMonth >= 8 ? 1 : 0);
      edge = ((schoolYear - hero.birthYear) * 12 + 4 - hero.birthMonth) / 12 - 0.05;
    }
    for (let k = 0; k < forkSlot - 2; k++) ages[k] = a0 + ((edge - a0) * (k + r() * 0.9)) / (forkSlot - 2);
    ages[forkSlot] = big.age[0] + 0.7;
    ages[forkSlot - 1] = big.age[0] + 0.5;
    ages[forkSlot - 2] = Math.max(ages[forkSlot - 3] ?? 0, big.age[0] + 0.3);
  }
  else if (forksToday.length) {
    fork = pickWeighted(r, forksToday.map((f) => [f, f.weight || 1]));
    const candidates = ages.map((a, i) => i).filter((i) => Math.floor(ages[i]) >= fork.age[0] && Math.floor(ages[i]) <= fork.age[1]);
    forkSlot = candidates.length ? pick(r, candidates) : times.length - 1;
    ages[forkSlot] = Math.max(ages[forkSlot], fork.age[0]);
  }

  // Дата каждого слота в месяцах от нулевого года. Конец школы привязан к календарю:
  // последний звонок в мае, экзамены и выпускной в июне, выбор «что дальше» в июле.
  const birthAbs = hero.birthYear * 12 + hero.birthMonth;
  const slotDates = ages.map((a, i) => {
    if (big && big.id === 'fk_after_school' && i >= forkSlot - 2) {
      const schoolYear = hero.birthYear + 17 + (hero.birthMonth >= 8 ? 1 : 0);
      return schoolYear * 12 + 6 - (forkSlot - i);
    }
    return birthAbs + Math.floor(a * 12);
  });
  if (hero.lastDate === undefined) hero.lastDate = birthAbs;

  // Куда во времени можно поставить событие в этом слоте. Сезонные события
  // (первое сентября, лагерь летом) ищут свой месяц между соседними сообщениями.
  const place = (e, i) => {
    const lo = hero.lastDate;
    const hi = i + 1 < slotDates.length ? slotDates[i + 1] : slotDates[i] + 6;
    const ok = (d) => {
      const age = Math.floor((d - birthAbs) / 12);
      return age >= e.age[0] && age <= e.age[1] && conditionsMet(e.if, hero, Math.floor(d / 12));
    };
    if (!e.months) { const d = Math.max(slotDates[i], lo); return ok(d) ? d : null; }
    let best = null;
    for (let d = lo; d <= Math.min(hi, lo + 48); d++) {
      if (e.months.includes((d % 12) + 1) && ok(d) && (best === null || Math.abs(d - slotDates[i]) < Math.abs(best - slotDates[i]))) best = d;
    }
    return best;
  };
  const labelOf = (d) => `${MONTHS[d % 12]} ${Math.floor(d / 12)}`;

  for (let i = 0; i < times.length; i++) {
    const clock = `${String(Math.floor(times[i] / 60)).padStart(2, '0')}:${String(times[i] % 60).padStart(2, '0')}`;

    if (dayPlan.day === 1 && i === 0) {
      out.push({ clock, label: labelOf(birthAbs), text: birthMessage(hero, content), type: 'birth' });
      continue;
    }

    if (i === forkSlot && fork) {
      const d = Math.max(slotDates[i], hero.lastDate);
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
    if (!pool.length) continue;
    const timeFactor = (e) => (e.time === period ? 4 : e.time === 'any' || !e.time ? 2 : 0.3);
    // Обязательные события (рождение брата, первый класс) ставим первыми.
    const must = pool.filter(([e]) => e.must);
    const [ev, d] = must.length ? must[0] : pickWeighted(r, pool.map((p) => [p, (p[0].weight || 1) * timeFactor(p[0])]));
    hero.used.add(ev.id);
    hero.lastDate = d;
    applyFx(ev.fx, hero, content);
    out.push({ clock, label: labelOf(d), type: 'event', id: ev.id, text: render(ev.text, hero, content) });
  }
  return out;
}

function liveLife(content, { birthYear, seed, chooseFork }) {
  const hero = createHero(content, { birthYear, seed });
  const days = DAYS.map((plan) => ({ day: plan.day, messages: liveDay(hero, content, plan, { chooseFork }) }));
  return { hero, days };
}

module.exports = { liveLife, createHero, render, DAYS };
