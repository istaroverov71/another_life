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
const DAYS = LIFE_PLAN;
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
    const y = String(Math.min(2020, Math.max(1980, birthYear)));
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
    // Возраст смерти: средняя продолжительность жизни в регионе для этого пола (Росстат, 2023)
    // с поправкой на то, что герой точно доживает до 30, и разбросом. Здоровье потом сдвигает его.
    deathBase: deathAge(r, region, gender),
    deathMonth: Math.floor(r() * 12),
    // Когда уходят родители: отцу и матери примерно на 25–30 лет больше, чем герою.
    dadDue: 44 + Math.floor(r() * 16),
    momDue: 50 + Math.floor(r() * 16),
    kids: [],
    jobs: [],
    job: null,
    forkLog: [],
    cities: [city.name],
    flags: [],
    used: new Set(),
    r,
  };
}


// ---------- Работа ----------
// Профессии и компании — content/world/careers.json. Компания выбирается по году и городу:
// иностранные — только пока они работали в России, после ухода их место занимают преемники.
function fieldWeight(field, year) {
  let w = field.w;
  for (const [y, k] of field.by_year || []) if (year >= y) w = k;
  return w;
}
function companyAt(job, year) {
  const c = job.company;
  let cur = { n: c.n, at: c.at };
  for (const r of c.renamed || []) if (year >= r.year) cur = { n: r.n, at: r.at };
  return cur;
}
function companyOk(c, hero, year) {
  if (year < (c.from || 0) || year > (c.left ? c.left - 1 : c.to || 9999)) return false;
  const t = hero.city.type;
  if (c.cities && !c.cities.includes(hero.city.name)) return false;
  if (c.big && !['capital', 'million', 'large'].includes(t)) return false;
  if (c.capital && t !== 'capital') return false;
  if (c.small && !['small', 'village', 'medium'].includes(t)) return false;
  return true;
}
function pickCompany(content, hero, field, year) {
  if (hero.city.type === 'abroad') return pick(hero.r, content.careers.abroad);
  const list = field.companies.filter((c) => companyOk(c, hero, year));
  if (!list.length) return { n: 'местная компания', at: 'в местной компании' };
  // Компания из своего города (завод в Тольятти) — в разы вероятнее общей.
  return pickWeighted(hero.r, list.map((c) => [c, (c.w || 1) * (c.cities ? 6 : 1)]));
}
function setJob(content, hero, spec, year) {
  const C = content.careers;
  let id = spec;
  if (Array.isArray(spec)) id = pickWeighted(hero.r, spec.map((f) => [f, fieldWeight(C.fields[f], year)]));
  if (spec === 'auto') {
    const edu = hero.flags.includes('uni') ? 'uni' : hero.flags.includes('college') ? 'college' : 'none';
    const options = Object.entries(C.fields).filter(([, f]) => f.edu.includes(edu) && f.auto !== false && (!f.place || f.place.includes(hero.city.type)));
    id = pickWeighted(hero.r, options.map(([k, f]) => [k, fieldWeight(f, year)]));
  }
  if (spec === 'same' && hero.job) id = hero.job.field;
  const field = C.fields[id];
  const prev = hero.job;
  if (prev) {
    const pf = C.fields[prev.field];
    hero.flags = hero.flags.filter((x) => x !== `job_${prev.field}` && !(pf.flags || []).includes(x));
    hero.jobs[hero.jobs.length - 1].to = year;
  }
  hero.job = { field: id, title: pick(hero.r, field.titles), company: pickCompany(content, hero, field, year), since: year };
  hero.jobs.push({ field: id, title: hero.job.title, company: hero.job.company, from: year });
  for (const f of [`job_${id}`, 'employed', ...(field.flags || [])]) if (!hero.flags.includes(f)) hero.flags.push(f);
}
// Компания ушла из России (или переименовалась) уже после того, как герой туда устроился.
function companyEvent(hero, year) {
  const j = hero.job;
  if (!j || hero.city.type === 'abroad') return null;
  const c = j.company;
  if (c.left && year >= c.left && j.since < c.left && !j.leftSeen) return c.successor ? 'successor' : 'closed';
  for (const r of c.renamed || []) if (year >= r.year && j.since < r.year && (j.renameSeen || 0) < r.year) return 'renamed';
  return null;
}

function deathAge(r, region, gender) {
  const le = region.life_expectancy[gender] || (gender === 'm' ? 68 : 79);
  const mean = le + (gender === 'm' ? 4 : 2);
  const sd = gender === 'm' ? 10 : 9;
  const z = Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
  return Math.round(Math.max(30, Math.min(97, mean + sd * z)));
}

// Итоговый возраст смерти: хорошее здоровье добавляет годы, плохое — отнимает.
function effectiveDeathAge(hero) {
  return Math.max(30, Math.min(99, hero.deathBase + Math.round((hero.stats.health - 65) / 8)));
}

function newPerson(r, content, hero, gender, birthYear) {
  const region = hero.city.region ? content.regions.find((g) => g.id === hero.city.region) || hero.region : hero.region;
  return { gender, birthYear, name: pickName(r, content, pickPool(r, region), gender, birthYear, [hero.name]) };
}

// Подстановка переменных в текст.
function render(text, hero, content) {
  const g = hero.gender;
  const forms = (spec, gender) => { const [m, f] = spec.split('|'); return gender === 'm' ? m : (f ?? ''); };
  return text
    .replace(/\{s:([^}]*)\}/g, (_, spec) => forms(spec, hero.sibling?.gender ?? 'm'))
    .replace(/\{fr:([^}]*)\}/g, (_, spec) => forms(spec, hero.friend.gender))
    .replace(/\{p:([^}]*)\}/g, (_, spec) => forms(spec, hero.partner?.gender ?? 'm'))
    .replace(/\{sp:([^}]*)\}/g, (_, spec) => forms(spec, hero.spouse?.gender ?? (hero.gender === 'm' ? 'f' : 'm')))
    .replace(/\{ex:([^}]*)\}/g, (_, spec) => forms(spec, hero.ex?.gender ?? (hero.gender === 'm' ? 'f' : 'm')))
    .replace(/\{k1:([^}]*)\}/g, (_, spec) => forms(spec, hero.kids[0]?.gender ?? 'm'))
    .replace(/\{k2:([^}]*)\}/g, (_, spec) => forms(spec, hero.kids[1]?.gender ?? 'm'))
    .replace(/\{([^{}:]*\|[^{}]*)\}/g, (_, spec) => forms(spec, g))
    .replace(/\{name\}/g, hero.name)
    .replace(/\{partner\}/g, hero.partner?.name ?? '')
    .replace(/\{spouse\}/g, hero.spouse?.name ?? '')
    .replace(/\{ex\}/g, hero.ex?.name ?? '')
    .replace(/\{kid1\}/g, hero.kids[0]?.name ?? '')
    .replace(/\{kid2\}/g, hero.kids[1]?.name ?? '')
    .replace(/\{job\}/g, () => (hero.job ? (hero.job.title.includes('|') ? forms(hero.job.title, g) : hero.job.title) : ''))
    .replace(/\{at_company\}/g, () => (hero.job ? companyAt(hero.job, hero.nowYear).at : ''))
    .replace(/\{company\}/g, () => (hero.job ? companyAt(hero.job, hero.nowYear).n : ''))
    .replace(/\{at_company_old\}/g, () => (hero.job?.old ? hero.job.old.at : ''))
    .replace(/\{company_old\}/g, () => (hero.job?.old ? hero.job.old.n : ''))
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

// Текст упоминает супруга, ребёнка, брата и т. д. — значит, этот человек должен существовать.
// У события может быть несколько вариантов текста (texts): подходит то, где хотя бы один вариант
// говорит только о тех, кто у героя есть.
const NEEDS_STR = new Map();
function needsOfStr(t) {
  let n = NEEDS_STR.get(t);
  if (!n) {
    n = {
      spouse: /\{(spouse|sp:)/.test(t), ex: /\{(ex\}|ex:)/.test(t), sib: /\{(sib\}|s:)/.test(t),
      kids: /\{(kid2|k2:)/.test(t) ? 2 : /\{(kid1|k1:)/.test(t) ? 1 : 0,
      job: /\{(job|at_company|company)/.test(t),
    };
    NEEDS_STR.set(t, n);
  }
  return n;
}
const NEEDS = new WeakMap();
function needsOf(obj) {
  let n = NEEDS.get(obj);
  if (!n) {
    const opts = JSON.stringify(obj.options || []);
    const makesChild = /"child":true/.test(opts);
    const makesSpouse = /"spouse":"new"/.test(opts);
    const makesJob = /"job":/.test(opts);
    const o = needsOfStr(opts);
    n = { spouse: !makesSpouse && o.spouse, ex: o.ex, sib: o.sib, kids: makesChild ? Math.max(0, o.kids - 1) : o.kids, job: !makesJob && o.job, makesChild, makesJob };
    NEEDS.set(obj, n);
  }
  return n;
}
function meets(n, hero, kidsBonus = 0, jobBonus = false) {
  if (n.spouse && !hero.spouse) return false;
  if (n.ex && !hero.ex) return false;
  if (n.sib && !hero.sibling) return false;
  if (n.job && !hero.job && !jobBonus) return false;
  return hero.kids.length + kidsBonus >= n.kids;
}
const textsOf = (obj) => obj.texts || [obj.text];
// Варианты текста, подходящие герою прямо сейчас.
function okTexts(obj, hero) {
  const bonus = obj.options && needsOf(obj).makesChild ? 1 : 0;
  const jobBonus = !!(obj.fx && obj.fx.job) || !!(obj.options && needsOf(obj).makesJob);
  return textsOf(obj).filter((t) => meets(needsOfStr(t), hero, bonus, jobBonus));
}
function peopleOk(obj, hero) {
  if (obj.options && !meets(needsOf(obj), hero)) return false;
  return okTexts(obj, hero).length > 0;
}
// Выбор варианта: случайный из подходящих. Возвращает текст и его номер.
function pickText(obj, hero) {
  const all = textsOf(obj);
  const ok = okTexts(obj, hero);
  const t = ok.length ? pick(hero.r, ok) : all[0];
  return { text: t, v: all.indexOf(t) };
}

function conditionsMet(cond, hero, year, obj) {
  if (obj && !peopleOk(obj, hero)) return false;
  if (!cond) return true;
  if (cond.years && (year < cond.years[0] || year > cond.years[1])) return false;
  if (cond.city && !cond.city.includes(hero.city.type)) return false;
  if (cond.region_in && !cond.region_in.includes(hero.city.region)) return false;
  if (cond.city_name && !cond.city_name.includes(hero.city.name)) return false;
  const heroAge = year - hero.birthYear;
  if (cond.dad_due && heroAge < hero.dadDue) return false;
  if (cond.mom_due && heroAge < hero.momDue) return false;
  if (cond.spouse_due && (!hero.spouse || year - hero.spouse.birthYear < hero.spouse.deathAge)) return false;
  if (cond.kids_min !== undefined && hero.kids.length < cond.kids_min) return false;
  if (cond.kids_max !== undefined && hero.kids.length > cond.kids_max) return false;
  if (cond.kid_age && (!hero.kids.length || year - hero.kids[0].birthYear < cond.kid_age[0] || year - hero.kids[0].birthYear > cond.kid_age[1])) return false;
  if (cond.health_max !== undefined && hero.stats.health > cond.health_max) return false;
  if (cond.health_min !== undefined && hero.stats.health < cond.health_min) return false;
  if (cond.money_max !== undefined && hero.stats.money > cond.money_max) return false;
  if (cond.money_min !== undefined && hero.stats.money < cond.money_min) return false;
  if (cond.any && !cond.any.some((f) => hero.flags.includes(f))) return false;
  if (cond.min_years_abroad && (hero.abroadSince === undefined || year - Math.floor(hero.abroadSince / 12) < cond.min_years_abroad)) return false;
  if (cond.company && companyEvent(hero, year) !== cond.company) return false;
  if (cond.field && (!hero.job || !cond.field.includes(hero.job.field))) return false;
  if (cond.not_field && hero.job && cond.not_field.includes(hero.job.field)) return false;
  if (cond.job_years && (!hero.job || year - hero.job.since < cond.job_years)) return false;
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
  const year = Math.floor((hero.lastDate ?? 0) / 12);
  const age = year - hero.birthYear;
  if (hero.flags.includes('retired') && !hero.retiredYear) hero.retiredYear = year;
  if (fx.spouse === 'new') {
    const g = hero.gender === 'm' ? 'f' : 'm';
    hero.spouse = newPerson(hero.r, content, hero, g, hero.birthYear + Math.floor(hero.r() * 5) - 2);
    hero.spouse.deathAge = deathAge(hero.r, hero.region, g);
  }
  if (fx.breakup) {
    hero.ex = hero.spouse; hero.spouse = null;
    hero.flags = hero.flags.filter((x) => !['dating', 'together', 'engaged'].includes(x));
  }
  if (fx.child) {
    const g = hero.r() < 0.514 ? 'm' : 'f';
    const kid = { gender: g, birthYear: year, name: pickName(hero.r, content, hero.familyPool, g, Math.min(2020, year), hero.kids.map((k) => k.name).concat([hero.name])) };
    hero.kids.push(kid);
    if (!hero.flags.includes('has_kids')) hero.flags.push('has_kids');
  }
  if (fx.divorce) {
    hero.ex = hero.spouse; hero.spouse = null;
    hero.flags = hero.flags.filter((x) => !['married', 'dating', 'together'].includes(x));
    if (!hero.flags.includes('divorced')) hero.flags.push('divorced');
    if (!hero.flags.includes('ever_divorced')) hero.flags.push('ever_divorced');
  }
  if (fx.widowed) {
    hero.ex = hero.spouse; hero.spouse = null;
    hero.flags = hero.flags.filter((x) => !['married', 'dating', 'together'].includes(x));
    hero.flags.push('widowed');
  }
  void age;
  if (fx.company) {
    const j = hero.job; const c = j.company;
    if (fx.company === 'renamed') {
      let before = { n: c.n, at: c.at };
      for (const r of c.renamed) { if (r.year > year) break; if (r.year > (j.renameSeen || 0) && r.year <= year) { j.old = before; } before = { n: r.n, at: r.at }; }
      j.renameSeen = year;
    } else {
      const old = companyAt(j, year);
      if (c.successor) { j.company = { ...c.successor }; hero.jobs[hero.jobs.length - 1].company = j.company; j.old = old; j.leftSeen = true; } else { setJob(content, hero, 'same', year); hero.job.old = old; hero.job.leftSeen = true; }
    }
  }
  if (fx.quit_job && hero.job) { hero.jobs[hero.jobs.length - 1].to = year; hero.flags = hero.flags.filter((x) => x !== `job_${hero.job.field}` && x !== 'employed'); hero.job = null; }
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
    } else if (fx.move === 'capital') {
      hero.city = all.find((c) => c.name === (hero.city.name === 'Москва' ? 'Санкт-Петербург' : 'Москва'));
    } else if (fx.move === 'region_center') {
      const reg = content.regions.find((g) => g.id === (hero.city.region || hero.region.id)) || hero.region;
      hero.city = { ...reg.cities[0], region: reg.id };
    } else if (fx.move === 'sea') {
      const sea = all.filter((c) => ['Сочи', 'Новороссийск', 'Краснодар', 'Калининград'].includes(c.name));
      hero.city = pick(hero.r, sea);
    } else if (fx.move === 'other_capital') {
      hero.city = all.find((c) => c.type === 'capital' && c.name !== hero.city.name);
    }
    if (hero.cities[hero.cities.length - 1] !== hero.city.name) hero.cities.push(hero.city.name);
    // Переезд — новое место работы в той же профессии (своё дело переезжает вместе с хозяином).
    if (hero.job && hero.job.field !== 'business' && !fx.job) setJob(content, hero, 'same', year);
  }
  if (fx.job) setJob(content, hero, fx.job, year);
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
  const inDay = (f) => f.age[0] <= a1 && f.age[1] >= a0 && !f.years && conditionsMet(f.if, hero, Math.floor((birthAbs + a0 * 12) / 12), f);
  // Календарная развилка (например, осень 2022-го): ищем подходящий месяц внутри дня.
  const calendarDate = (f) => {
    for (let d = birthAbs + a0 * 12; d < birthAbs + (a1 + 1) * 12; d++) {
      const y = Math.floor(d / 12); const age = ageAt(d);
      if (y >= f.years[0] && y <= f.years[1] && (!f.months || f.months.includes((d % 12) + 1))
        && age >= f.age[0] && age <= f.age[1] && conditionsMet(f.if, hero, y, f)) return d;
    }
    return null;
  };
  const priority = content.forks.filter((f) => f.priority && f.years).map((f) => [f, calendarDate(f)]).find(([, d]) => d !== null);
  const big = content.forks.find((f) => f.kind === 'big' && inDay(f));
  const smalls = content.forks.filter((f) => f.kind !== 'big' && inDay(f));
  let fork = big || (priority ? priority[0] : null) || (smalls.length ? pickWeighted(r, smalls.map((f) => [f, f.weight || 1])) : null);

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
  // Смерть: если она приходится на этот день, годы после неё не нужны, а её год
  // покрывает само сообщение о смерти.
  const dAge = effectiveDeathAge(hero);
  let deathDate = null;
  // Если здоровье сдвинуло возраст смерти на уже прошедшие годы, смерть приходит в этом дне.
  if (dAge <= a1 && a0 >= 18) {
    deathDate = Math.max(birthAbs + Math.max(dAge, a0) * 12 + hero.deathMonth, hero.lastDate + 1);
    years = years.filter((y) => y < ageAt(deathDate));
    slots.push({ date: deathDate, fixed: true, death: true });
  }
  // Встреча в режиме «вдвоём»: фиксированная дата, одинаковая у обоих героев.
  // Её год уже покрыт самой встречей, отдельное сообщение для него не нужно.
  if (meeting && meeting.date >= birthAbs + a0 * 12 && meeting.date < birthAbs + (a1 + 1) * 12) {
    const y = ageAt(meeting.date);
    years = years.filter((x) => x !== y);
    slots.push({ date: meeting.date, fixed: true, meeting: true });
  }
  // Глубокая старость: если лет больше, чем помещается сообщений, тихие годы
  // объединяются в одно сообщение с диапазоном — так ни один год не пропадает.
  if (years.length > 7) {
    const groups = Array.from({ length: 7 }, () => []);
    years.forEach((y, i) => groups[Math.floor((i * 7) / years.length)].push(y));
    years = groups.filter((g) => g.length === 1).map((g) => g[0]);
    for (const g of groups.filter((x) => x.length > 1)) slots.push({ date: birthAbs + g[0] * 12 + Math.floor(r() * 6), span: g, year: g[0] });
  }
  const counts = Object.fromEntries(years.map((y) => [y, 1]));
  const fixedEvents = slots.filter((x) => !x.fork).length;
  const total = Math.min(8, Math.max(5, years.length + fixedEvents + Math.floor(r() * 3)));
  const extraYears = years.filter((y) => !(dayPlan.day === 1 && y === 0)); // год 0 занят рождением
  for (let k = years.length + fixedEvents; k < total && extraYears.length; k++) counts[pick(r, extraYears)]++;
  for (const y of years) {
    const months = [];
    while (months.length < counts[y]) { const m = Math.floor(r() * 12); if (!months.includes(m)) months.push(m); }
    months.sort((a, b) => a - b).forEach((m) => slots.push({ date: birthAbs + y * 12 + m, year: y }));
  }
  if (dayPlan.day === 1) {
    const first = slots.find((x) => x.year === 0);
    first.birth = true; first.date = birthAbs;
  }
  if (fork && !big && priority && fork === priority[0] && (!deathDate || priority[1] < deathDate)) {
    slots.push({ date: priority[1], year: ageAt(priority[1]), fork: true });
  } else if (fork && !big && years.length) {
    const ys = years.filter((y) => y >= fork.age[0] && y <= fork.age[1]);
    const y = ys.length ? pick(r, ys) : years[years.length - 1];
    slots.push({ date: birthAbs + y * 12 + Math.floor(r() * 12), year: y, fork: true });
  }
  slots.sort((a, b) => a.date - b.date || (a.fork ? 1 : 0) - (b.fork ? 1 : 0));
  const times = clockTimes(r, slots.length);

  const labelOf = (d) => `${MONTHS[d % 12]} ${Math.floor(d / 12)} · ${ageWord(ageAt(d))}`;
  const spanLabel = (g) => `${hero.birthYear + g[0] + (hero.birthMonth > 0 ? 0 : 0)}–${hero.birthYear + g[g.length - 1]} · ${g[0]}–${ageWord(g[g.length - 1])}`;

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
      return age >= e.age[0] && age <= e.age[1] && conditionsMet(e.if, hero, Math.floor(d / 12), e);
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

    if (slot.death) {
      const d = Math.max(slot.date, hero.lastDate);
      hero.lastDate = d;
      const pool = content.deaths.filter((e) => conditionsMet(e.if, hero, Math.floor(d / 12), e) && ageAt(d) >= (e.age || [0])[0] && ageAt(d) <= (e.age || [0, 200])[1]);
      const ev = pickWeighted(r, pool.map((e) => [e, e.weight || 1]));
      hero.nowYear = Math.floor(d / 12);
      const dt = pickText(ev, hero);
      out.push({ clock, label: labelOf(d), type: 'death', id: ev.id, v: dt.v, text: render(dt.text, hero, content).replace('{age}', ageWord(ageAt(d))), date: d });
      hero.dead = true; hero.deathDate = d;
      out.push({ clock: '20:00', label: 'Итог жизни', type: 'final', text: finale(hero, content) });
      break;
    }
    if (slot.span) {
      const d = Math.max(slot.date, hero.lastDate);
      const pool = content.events.filter((e) => e.span && !hero.used.has(e.id) && e.age[0] <= slot.span[slot.span.length - 1] && e.age[1] >= slot.span[0]
        && conditionsMet(e.if, hero, Math.floor(d / 12), e));
      const ev = pool.length ? pickWeighted(r, pool.map((e) => [e, e.weight || 1])) : { id: 'quiet_span', text: pick(r, content.fills.quiet_span) };
      hero.used.add(ev.id);
      applyFx(ev.fx, hero, content);
      hero.lastDate = birthAbs + slot.span[slot.span.length - 1] * 12 + 11;
      const endDate = birthAbs + slot.span[slot.span.length - 1] * 12 + 11;
      hero.nowYear = Math.floor(d / 12);
      const sp = ev.texts ? pickText(ev, hero) : { text: ev.text, v: 0 };
      out.push({ clock, label: `${Math.floor(d / 12)}–${Math.floor(endDate / 12)} · ${slot.span[0]}–${ageWord(slot.span[slot.span.length - 1])}`, type: 'span', id: ev.id, v: sp.v, text: render(sp.text, hero, content), date: d });
      continue;
    }
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
      hero.nowYear = Math.floor(d / 12);
      let options = fork.options.filter((o) => conditionsMet(o.if, hero, Math.floor(d / 12)));
      // Развилка с большим списком (например, выбор профессии) показывает только pick вариантов:
      // каждый раз разные, с учётом того, насколько профессия распространена в этот год.
      if (fork.pick && options.length > fork.pick) {
        const keep = options.filter((o) => o.always);
        const pool = options.filter((o) => !o.always).map((o) => [o, o.weight || (o.fx && typeof o.fx.job === 'string' && content.careers.fields[o.fx.job] ? fieldWeight(content.careers.fields[o.fx.job], hero.nowYear) : 1)]);
        const chosenOpts = [];
        while (chosenOpts.length < fork.pick - keep.length && pool.length) {
          const o = pickWeighted(r, pool); chosenOpts.push(o); pool.splice(pool.findIndex(([x]) => x === o), 1);
        }
        options = fork.options.filter((o) => chosenOpts.includes(o) || keep.includes(o));
      }
      const chosenIdx = chooseFork ? chooseFork(fork, options) : Math.floor(r() * options.length);
      const chosen = options[chosenIdx];
      const ft = pickText(fork, hero);
      const forkText = render(ft.text, hero, content);
      applyFx(chosen.fx, hero, content);
      const res = chosen.results ? pick(r, chosen.results) : chosen.result;
      hero.forkLog.push({ age: ageAt(d), title: fork.title || fork.text, chosen: chosen.label.replace(/^[^А-Яа-яЁёA-Za-z0-9«]+/, ''), big: fork.kind === 'big' || fork.key });
      out.push({
        clock, label: labelOf(d), type: 'fork', id: fork.id,
        text: forkText,
        options: options.map((o) => o.label),
        chosen: chosen.label,
        v: ft.v,
        result: render(res, hero, content),
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
      const fresh = (e) => (hero.seenBefore && hero.seenBefore.has(e.id) ? 0.12 : 1);
      [ev, d] = pickWeighted(r, use.map((p) => [p, (p[0].weight || (p[0].filler ? 0.7 : 1)) * timeFactor(p[0]) * fresh(p[0])]));
      hero.used.add(ev.id);
    } else {
      // Подстраховка: год не должен пропадать, даже если подходящих событий не осталось.
      d = Math.max(slot.date, hero.lastDate);
      const key = ageAt(d) < 7 ? 'quiet_year_small' : 'quiet_year_school';
      ev = { id: key, text: pick(r, content.fills[key]) };
    }
    hero.lastDate = d;
    hero.nowYear = Math.floor(d / 12);
    // Текст до последствий: супруг ещё жив, бывший ещё не бывший. Кроме событий про смену
    // работы (render_after): там текст говорит уже о новом месте.
    let evText; let v = 0;
    if (ev.render_after) { applyFx(ev.fx, hero, content); ({ text: evText, v } = pickText(ev, hero)); evText = render(evText, hero, content); } else {
      ({ text: evText, v } = pickText(ev, hero)); evText = render(evText, hero, content);
      applyFx(ev.fx, hero, content);
    }
    out.push({ clock, label: labelOf(d), type: 'event', id: ev.id, v, text: evText, age: ageAt(d), date: d });
  }
  return out;
}

// Итог жизни: кем был, где жил, семья и главные развилки.
function finale(hero, content) {
  const deathYear = Math.floor(hero.deathDate / 12);
  const cityName = (n) => n[0].toUpperCase() + n.slice(1);
  const lines = [`${hero.name}, ${hero.birthYear}–${deathYear}. ${hero.cities.map(cityName).join(' → ')}.`];
  const fam = [];
  if (hero.spouse && hero.flags.includes('married')) fam.push(`${hero.gender === 'm' ? 'жена' : 'муж'} ${hero.spouse.name}`);
  else if (hero.spouse) fam.push(`${hero.spouse.name} — ${hero.spouse.gender === 'm' ? 'любимый' : 'любимая'}, без штампа, но на всю жизнь`);
  else if (hero.flags.includes('widowed') && hero.ex) fam.push(`${hero.gender === 'm' ? 'жена' : 'муж'} ${hero.ex.name}, ушедш${hero.ex.gender === 'm' ? 'ий' : 'ая'} раньше`);
  if (hero.kids.length) fam.push(`${hero.kids.length === 1 ? (hero.kids[0].gender === 'm' ? 'сын' : 'дочь') : 'дети'} ${hero.kids.map((k) => k.name).join(' и ')}`);
  if (hero.flags.includes('grandkids')) fam.push('внуки');
  lines.push(fam.length ? `Семья: ${fam.join(', ')}.` : 'Семьи так и не завёл{|а}, зато друзей было много.');
  // Дело жизни: работа, где герой провёл больше всего лет.
  const yearsWord = (n) => ageWord(n).replace('год', 'год').replace(/^(\d+) /, '$1 ');
  const jobs = hero.jobs.map((j) => ({ ...j, len: (j.to ?? Math.min(deathYear, hero.retiredYear ?? deathYear)) - j.from }));
  const main = jobs.sort((x, y) => y.len - x.len)[0];
  if (main && main.len >= 2) {
    const at = companyAt({ company: main.company }, main.to ?? deathYear).at;
    const t = main.title.includes('|') ? main.title.split('|')[hero.gender === 'm' ? 0 : 1] : main.title;
    lines.push(`Дольше всего — ${t} ${at}: ${yearsWord(main.len)}.${hero.jobs.length > 2 ? ` Всего мест работы: ${hero.jobs.length}.` : ''}`);
  }
  const work = content.fills.final_work?.find((w) => hero.flags.includes(w.flag));
  if (work) lines.push(work.text);
  lines.push('', 'Главные развилки:');
  // Одна развилка — одна строка: если вопрос повторялся, в итог идёт последнее решение.
  const byTitle = new Map();
  for (const f of hero.forkLog) byTitle.set(f.title, f);
  const uniq = [...byTitle.values()];
  for (const f of uniq.filter((x) => x.big).concat(uniq.filter((x) => !x.big)).slice(0, 10).sort((a, b) => a.age - b.age)) {
    lines.push(`• ${ageWord(f.age)}: ${f.title.replace(/\{[^}]*\}/g, '').slice(0, 80)} → ${f.chosen}`);
  }
  lines.push('', 'Статистика поколения появится, когда наберётся больше прожитых жизней.', '', '🔁 Прожить ещё одну жизнь?');
  return render(lines.join('\n'), hero, content);
}

// seenBefore — события, которые игрок уже читал в прошлых жизнях: они выпадают в разы реже.
function liveLife(content, { birthYear, seed, chooseFork, seenBefore }) {
  const hero = createHero(content, { birthYear, seed });
  hero.seenBefore = seenBefore || null;
  const days = [];
  for (const plan of DAYS) {
    days.push({ day: plan.day, messages: liveDay(hero, content, plan, { chooseFork }) });
    if (hero.dead) break;
  }
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
      a: a.dead ? [] : liveDay(a, content, dayPlan, { chooseFork, meeting }),
      b: b.dead ? [] : liveDay(b, content, dayPlan, { chooseFork, meeting }),
    });
  }
  return { a, b, plan, days };
}

module.exports = { liveLife, liveDay, createHero, render, DAYS, LIFE_PLAN, dayOfAge, planMeeting, liveDuo };
