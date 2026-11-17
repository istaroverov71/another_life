// Движок жизни: по файлам из content/ проживает жизнь героя и возвращает
// список сообщений по дням. Без зависимостей, чтобы потом этот же код
// переехал в бота на Cloudflare без изменений.

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль',
  'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Дни жизни и возраст, который они покрывают. У каждого года — минимум одно
// сообщение, поэтому в день помещается не больше 6–7 лет. Пока написан только
// контент детства, остальные дни добавятся вместе с контентом.
// Полный план жизни на 21 день (см. концепцию, раздел «Темп»).
const LIFE_PLAN = [
  [0, 5], [6, 11], [12, 17],
  [18, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 33], [34, 36], [37, 38], [39, 40],
  [41, 44], [45, 48], [49, 52], [53, 56], [57, 60],
  [61, 67], [68, 74], [75, 100],
].map((ages, i) => ({ day: i + 1, ages }));
// Дни, для которых уже написан контент.
const DAYS = LIFE_PLAN.filter((d) => d.ages[1] <= 17);
const dayOfAge = (age) => LIFE_PLAN.find((d) => age >= d.ages[0] && age <= d.ages[1]).day;

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
function pickBirthplace(r, content, birthYear, forced) {
  if (forced) return forced;
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
  const word = { 'в селе': 'село', 'в деревне': 'деревня', 'в станице': 'станица' }[region.village_word];
  return { region, city: { name: `${word}, ${region.id}`, in: `${region.village_word} ${region.in}`, type: 'village', region: region.id } };
}

function createHero(content, { birthYear, seed, place }) {
  const r = rng(seed);
  const start = content.start;
  const { region, city } = pickBirthplace(r, content, birthYear, place);
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
    .replace(/\{p:([^}]*)\}/g, (_, spec) => forms(spec, hero.partner?.gender ?? 'm'))
    .replace(/\{([^{}:]*\|[^{}]*)\}/g, (_, spec) => forms(spec, g))
    .replace(/\{name\}/g, hero.name)
    .replace(/\{partner\}/g, hero.partner?.name ?? '')
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
  if (cond.region_in && !cond.region_in.includes(hero.city.region)) return false;
  if (cond.city_name && !cond.city_name.includes(hero.city.name)) return false;
  if (cond.min_years_abroad && (hero.abroadSince === undefined || year - Math.floor(hero.abroadSince / 12) < cond.min_years_abroad)) return false;
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
  for (const f of fx.unflags || []) hero.flags = hero.flags.filter((x) => x !== f);
  if (fx.move) {
    const all = content.regions.flatMap((g) => g.cities.map((c) => ({ ...c, region: g.id })));
    if (fx.move === 'big') {
      const options = all.filter((c) => ['capital', 'million'].includes(c.type) && c.name !== hero.city.name);
      hero.city = pickWeighted(hero.r, options.map((c) => [c, c.pop]));
    } else if (fx.move === 'home') {
      hero.city = hero.homeCity || hero.birthCity;
    } else if (fx.move === 'abroad') {
      hero.homeCity = hero.city;
      hero.abroadSince = hero.lastDate;
      hero.city = pick(hero.r, [
        { name: 'Ереван', in: 'в Ереване', type: 'abroad' }, { name: 'Тбилиси', in: 'в Тбилиси', type: 'abroad' },
        { name: 'Алматы', in: 'в Алматы', type: 'abroad' }, { name: 'Белград', in: 'в Белграде', type: 'abroad' },
        { name: 'Стамбул', in: 'в Стамбуле', type: 'abroad' }]);
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

function liveDay(hero, content, dayPlan, { chooseFork, meeting } = {}) {
  const r = hero.r;
  const [a0, a1] = dayPlan.ages;
  const out = [];
  const birthAbs = hero.birthYear * 12 + hero.birthMonth;
  const ageAt = (d) => Math.floor((d - birthAbs) / 12);
  if (hero.lastDate === undefined) hero.lastDate = birthAbs;

  // Развилка дня: большая, если её возраст попадает в день, иначе одна маленькая.
  const inDay = (f) => f.age[0] <= a1 && f.age[1] >= a0 && !f.years && conditionsMet(f.if, hero, Math.floor((birthAbs + a0 * 12) / 12));
  // Календарная развилка (например, осень 2022-го): ищем подходящий месяц внутри дня.
  const calendarDate = (f) => {
    for (let d = birthAbs + a0 * 12; d < birthAbs + (a1 + 1) * 12; d++) {
      const y = Math.floor(d / 12); const age = ageAt(d);
      if (y >= f.years[0] && y <= f.years[1] && (!f.months || f.months.includes((d % 12) + 1))
        && age >= f.age[0] && age <= f.age[1] && conditionsMet(f.if, hero, y)) return d;
    }
    return null;
  };
  const priority = content.forks.filter((f) => f.priority && f.years).map((f) => [f, calendarDate(f)]).find(([, d]) => d !== null);
  const big = content.forks.find((f) => f.kind === 'big' && inDay(f));
  const smalls = content.forks.filter((f) => f.kind !== 'big' && inDay(f));
  const fork = big || (priority ? priority[0] : null) || (smalls.length ? pickWeighted(r, smalls.map((f) => [f, f.weight || 1])) : null);

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
  // Встреча в режиме «вдвоём»: фиксированная дата, одинаковая у обоих героев.
  // Её год уже покрыт самой встречей, отдельное сообщение для него не нужно.
  if (meeting && meeting.date >= birthAbs + a0 * 12 && meeting.date < birthAbs + (a1 + 1) * 12) {
    const y = ageAt(meeting.date);
    years = years.filter((x) => x !== y);
    slots.push({ date: meeting.date, fixed: true, meeting: true });
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
  if (fork && !big && priority && fork === priority[0]) {
    slots.push({ date: priority[1], year: ageAt(priority[1]), fork: true });
  } else if (fork && !big) {
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

    if (slot.meeting) {
      hero.lastDate = Math.max(hero.lastDate, slot.date);
      out.push({ clock, label: labelOf(slot.date), type: 'meeting', id: meeting.id, text: render(meeting.text(hero), hero, content), date: slot.date });
      if (!hero.flags.includes('met_partner')) hero.flags.push('met_partner');
      continue;
    }
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
    out.push({ clock, label: labelOf(d), type: 'event', id: ev.id, text: render(ev.text, hero, content), age: ageAt(d), date: d });
  }
  return out;
}

function liveLife(content, { birthYear, seed, chooseFork }) {
  const hero = createHero(content, { birthYear, seed });
  const days = DAYS.map((plan) => ({ day: plan.day, messages: liveDay(hero, content, plan, { chooseFork }) }));
  return { hero, days };
}

// ---------- Режим «вдвоём» ----------

// Дата встречи в месяцах. Должна попасть в один и тот же день игры у обоих героев,
// иначе друзья увидят встречу в разные дни.
function meetingDate(r, a, b, ageFrom, ageTo, months) {
  const birthA = a.birthYear * 12 + a.birthMonth;
  const birthB = b.birthYear * 12 + b.birthMonth;
  const ok = [];
  for (let d = Math.max(birthA, birthB) + ageFrom * 12; d <= Math.min(birthA, birthB) + (ageTo + 1) * 12 - 1; d++) {
    const ageA = Math.floor((d - birthA) / 12); const ageB = Math.floor((d - birthB) / 12);
    if (ageA < ageFrom || ageB < ageFrom || ageA > ageTo || ageB > ageTo) continue;
    if (dayOfAge(ageA) !== dayOfAge(ageB)) continue;
    if (months && !months.includes((d % 12) + 1)) continue;
    ok.push(d);
  }
  return ok.length ? pick(r, ok) : null;
}

// План встречи. Гарантия: встреча всегда есть и всегда до 30 лет.
function planMeeting(content, a, b, r) {
  const sameCity = a.birthCity.name === b.birthCity.name;
  const pickScenario = (kind, ageFrom, ageTo) => {
    const list = content.meetings.filter((m) => m.kind === kind && m.age[0] <= ageTo && m.age[1] >= ageFrom);
    for (const m of [...list].sort(() => r() - 0.5)) {
      const d = meetingDate(r, a, b, Math.max(ageFrom, m.age[0]), Math.min(ageTo, m.age[1]), m.months);
      if (d !== null) return { scenario: m, date: d };
    }
    return null;
  };
  let plan = null;
  if (sameCity) plan = pickScenario('childhood', 6, 14);
  // Иначе — встреча во взрослой жизни, по умолчанию 18–26, запасной сценарий «издалека».
  if (!plan) plan = pickScenario('far', 18, 26);
  // Страховка: если ничего не подошло, ищем любой сценарий до 29 лет включительно.
  if (!plan) plan = pickScenario('far', 18, 29) || pickScenario('same_city', 15, 29);
  return plan;
}

function liveDuo(content, { birthYear, seedA, seedB, sameCityChance = 0.3, chooseFork }) {
  const r = rng(seedA * 31 + seedB);
  const a = createHero(content, { birthYear, seed: seedA });
  // В одном городе — значит и имена, и окружение второго героя из этого же региона.
  const same = r() < sameCityChance;
  const b = createHero(content, { birthYear, seed: seedB, place: same ? { region: a.region, city: a.birthCity } : undefined });
  a.partner = { name: b.name, gender: b.gender };
  b.partner = { name: a.name, gender: a.gender };
  let plan = planMeeting(content, a, b, r);
  const days = [];
  for (const dayPlan of DAYS) {
    // Если оба героя уже живут в одном городе, встреча может случиться раньше плана.
    if (plan && !a.flags.includes('met_partner') && dayPlan.day > 3 && a.city.name === b.city.name) {
      const early = content.meetings.find((m) => m.kind === 'same_city');
      const d = meetingDate(r, a, b, dayPlan.ages[0], dayPlan.ages[1]);
      if (d !== null && d < plan.date) plan = { scenario: early, date: d };
    }
    const meeting = plan && { id: plan.scenario.id, date: plan.date, text: () => plan.scenario.text };
    days.push({
      day: dayPlan.day,
      a: liveDay(a, content, dayPlan, { chooseFork, meeting }),
      b: liveDay(b, content, dayPlan, { chooseFork, meeting }),
    });
  }
  return { a, b, plan, days };
}

module.exports = { liveLife, liveDay, createHero, render, DAYS, LIFE_PLAN, dayOfAge, planMeeting, liveDuo };
