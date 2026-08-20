#!/usr/bin/env node

/**
 * korea-job-board.mjs — lightweight HTML parsers for Korean job boards.
 *
 * Outputs jobs-json-v1 for providers/local-parser.mjs:
 *   [{ title, url, company, location, description }]
 *
 * This is intentionally conservative and zero-token: it fetches public listing
 * pages, extracts stable job-detail links, and leaves final suitability scoring
 * to the Korea EE evaluation overlay.
 */

import { decodeEntities as decodeHtmlEntities } from '../../providers/_html-entities.mjs';

const DEFAULT_KEYWORDS = [
  '전기전자', '전기공학', '전자공학', '전력', '회로설계', '제어', '임베디드',
  '반도체 장비', '배터리 BMS', '전장', '플랜트 전기',
];

const SOURCES = new Set(['jobkorea', 'saramin', 'linkareer', 'catch', 'jasoseol', 'recruiter']);

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  const pref = `${name}=`;
  const hit = process.argv.find(a => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

function parseKeywords() {
  const raw = argValue('--keywords');
  if (!raw) return DEFAULT_KEYWORDS;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutize(rawUrl, base) {
  try { return new URL(decodeHtmlEntities(rawUrl), base).href; } catch { return ''; }
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 career-ops-korea-ee/1.0',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
      },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

function addJob(map, raw) {
  const url = raw.url || '';
  const title = cleanText(raw.title);
  if (!url || !title || title.length < 3) return;
  const prev = map.get(url);
  const next = {
    title,
    url,
    company: cleanText(raw.company) || raw.source || '',
    location: cleanText(raw.location),
    description: cleanText(raw.description),
  };
  if (!prev || next.title.length > prev.title.length || next.description.length > prev.description.length) {
    map.set(url, next);
  }
}

function titleLooksUseful(text) {
  const t = cleanText(text);
  if (t.length < 4 || t.length > 140) return false;
  if (/^(상세요강|접수기간|기업정보|스크랩|즉시지원|홈페이지 지원|채용정보|채용달력|공유|지원하기)$/.test(t)) return false;
  return /채용|모집|신입|경력|인턴|엔지니어|Engineer|전기|전자|전력|회로|제어|임베디드|반도체|배터리|전장|설비|PLC|BMS|HW|Hardware/i.test(t);
}

function isRelevantKoreaEe(job) {
  const text = `${job.title || ''} ${job.description || ''}`;
  const positive = /전기전자|전기공학|전자공학|전력전자|전력|전기설비|수배전|보호계전|회로|PCB|제어|임베디드|펌웨어|반도체|계측|PLC|FA|배터리|BMS|모터|인버터|전장|차량제어|통신|신호처리|센서|EMC|플랜트 전기|전기시공|Electrical|Electronics|Power Electronics|Circuit|Hardware|Control|Embedded|Firmware|Semiconductor|Battery|Instrumentation/i;
  const negative = /마케팅|회계|재무|인사|총무|법무|공인노무사|IR|외환관리|자금조달|재무회계|학과사무실|행정직원|운영교수|교육조교|실습조교|고객상담|고객센터|상담사|콜센터|영업관리|영업지원|국내영업|해외영업|장비영업|전장영업|영업팀|영업,?구매|사업 영업|구매 담당|구매팀|자재구매|인허가|공무 업무|공무\b|환경관리|경노무|미화|사무직원|사무보조|조립 작업자|제품 조립|단순 조립|전장배선 조립|조립원|생산직|품질관리\(QA\)|역검|이관용|매장|조리|미용|간호|생활용품|화장품|의류|식품|쇼핑몰/i;
  return positive.test(text) && !negative.test(`${job.title || ''}`);
}

function priorityScore(job) {
  const text = `${job.title || ''} ${job.description || ''}`;
  let score = 0;
  if (/신입|인턴|채용연계|Junior|Entry|경력무관|무관|산학장학생|연구보조|현장실습/i.test(text)) score += 100;
  if (/전기전자|전기공학|전력전자|회로|PCB|제어|임베디드|펌웨어|반도체|배터리|BMS|전장|Electrical|Electronics|Hardware|Embedded|Firmware|Semiconductor|Battery/i.test(text)) score += 40;
  if (/경력\s*\d+|\d+\s*년|경력직|팀장|리더|책임|수석|Senior/i.test(text) && !/신입\s*[/·, ]\s*경력|신입.*경력|경력무관|무관/i.test(text)) score -= 60;
  if (/영업|구매|공무|조립|생산직|조교|교수|사무|행정|상담/i.test(job.title || '')) score -= 100;
  return score;
}

function nearby(html, index, span = 1200) {
  return html.slice(Math.max(0, index - span), Math.min(html.length, index + span));
}

function extractAnchors(html, base, urlRe, sourceName) {
  const jobs = new Map();
  const aRe = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html))) {
    const href = m[2];
    const url = absolutize(href, base);
    if (!urlRe.test(url)) continue;
    const text = cleanText(m[4]);
    if (!titleLooksUseful(text)) continue;
    const ctx = nearby(html, m.index);
    addJob(jobs, {
      title: text,
      url,
      company: sourceName,
      location: guessLocation(ctx),
      description: ctx,
      source: sourceName,
    });
  }
  return jobs;
}

function guessLocation(text) {
  const t = cleanText(text);
  const hits = ['서울','경기','인천','대전','세종','천안','아산','평택','화성','용인','수원','청주','구미','울산','부산','광주','전국','재택','Remote','Korea','Seoul']
    .filter(k => t.includes(k));
  return [...new Set(hits)].slice(0, 4).join(', ');
}

function mergeMaps(target, src) {
  for (const job of src.values()) addJob(target, job);
}

async function parseJobKorea(keywords) {
  const out = new Map();
  for (const kw of keywords) {
    const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(kw)}`;
    const html = await fetchText(url);
    mergeMaps(out, extractAnchors(html, url, /\/Recruit\/GI_Read\/\d+/i, 'JobKorea'));
  }
  return out;
}

async function parseSaramin(keywords) {
  const out = new Map();
  for (const kw of keywords) {
    const url = `https://www.saramin.co.kr/zf_user/search/recruit?searchword=${encodeURIComponent(kw)}`;
    const html = await fetchText(url);
    mergeMaps(out, extractAnchors(html, url, /\/zf_user\/jobs\/relay\/view/i, 'Saramin'));
  }
  return out;
}

function extractNextJson(html) {
  const m = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(decodeHtmlEntities(m[1])); } catch { return null; }
}

function walkJson(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkJson(item, visit);
  } else if (value && typeof value === 'object') {
    visit(value);
    for (const v of Object.values(value)) walkJson(v, visit);
  }
}

function extractJsonJobs(obj, base, sourceName, urlPredicate) {
  const out = new Map();
  walkJson(obj, (o) => {
    const rawUrl = o.url || o.link_url || o.href || o.detailUrl || o.recruitUrl;
    const url = rawUrl ? absolutize(rawUrl, base) : '';
    if (!url || !urlPredicate(url)) return;
    const title = o.name || o.title || o.subject || o.recruitTitle || o.activityName;
    if (!titleLooksUseful(title)) return;
    addJob(out, {
      title,
      url,
      company: o.companyName || o.company || o.organizationName || sourceName,
      location: o.location || o.region || o.address || '',
      description: JSON.stringify(o).slice(0, 2000),
      source: sourceName,
    });
  });
  return out;
}

async function parseLinkareer(keywords) {
  const out = new Map();
  const urls = [
    'https://linkareer.com/list/recruit?filterBy_interestIDs=11',
    ...keywords.map(kw => `https://linkareer.com/list/recruit?keyword=${encodeURIComponent(kw)}`),
  ];
  for (const url of urls) {
    const html = await fetchText(url);
    const obj = extractNextJson(html);
    if (obj) mergeMaps(out, extractJsonJobs(obj, url, 'Linkareer', u => /linkareer\.com\/activity\/\d+/.test(u)));
    mergeMaps(out, extractAnchors(html, url, /linkareer\.com\/activity\/\d+/, 'Linkareer'));
  }
  return out;
}

async function parseCatch(keywords) {
  const out = new Map();
  const urls = [
    'https://www.catch.co.kr/NCS/RecruitSearch',
    ...keywords.map(kw => `https://www.catch.co.kr/NCS/RecruitSearch?Keyword=${encodeURIComponent(kw)}`),
  ];
  for (const url of urls) {
    const html = await fetchText(url);
    mergeMaps(out, extractAnchors(html, url, /\/NCS\/RecruitInfoDetails\/\d+/i, 'Catch'));
  }
  return out;
}

async function parseJasoseol(keywords) {
  const out = new Map();
  const urls = [
    'https://jasoseol.com/recruit',
    ...keywords.map(kw => `https://jasoseol.com/recruit?search=${encodeURIComponent(kw)}`),
  ];
  for (const url of urls) {
    const html = await fetchText(url);
    const obj = extractNextJson(html);
    if (obj) mergeMaps(out, extractJsonJobs(obj, url, 'Jasoseol', u => /jasoseol\.com\/recruit|recruiter\.co\.kr|jobnotice|recruit/i.test(u)));
    mergeMaps(out, extractAnchors(html, url, /jasoseol\.com\/recruit|recruiter\.co\.kr|jobnotice|recruit/i, 'Jasoseol'));
  }
  return out;
}

function toEpochMsFromMidasDate(value) {
  if (!value || typeof value !== 'object') return undefined;
  const t = Number(value.time);
  return Number.isFinite(t) && t > 0 ? t : undefined;
}

async function fetchRecruiterJson(baseUrl, pageIndex = 1, keyword = '') {
  const base = new URL(baseUrl);
  const endpoint = new URL('/app/jobnotice/list.json', base);
  const body = new URLSearchParams({
    pageIndex: String(pageIndex),
    pageSize: '100',
    recruitClassSn: '',
    recruitClassName: '',
    jobnoticeStateCode: '',
    searchByNameOnly: 'true',
    keyword,
    systemKindCode: 'MRS2',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 career-ops-korea-ee/1.0',
        'accept-language': 'ko-KR,ko;q=0.9,en;q=0.7',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        referer: new URL('/app/jobnotice/list?systemKindCode=MRS2', base).href,
      },
      body,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function parseRecruiter(keywords) {
  const rawUrl = argValue('--url') || argValue('--careers-url') || 'https://wonik.recruiter.co.kr';
  const base = new URL(rawUrl).origin;
  const out = new Map();
  const searchTerms = ['', ...keywords];
  for (const keyword of searchTerms) {
    const first = await fetchRecruiterJson(base, 1, keyword);
    const totalPages = Math.min(Number(first?.pageUtil?.lastPage || 1) || 1, keyword ? 2 : 4);
    for (let page = 1; page <= totalPages; page++) {
      const data = page === 1 ? first : await fetchRecruiterJson(base, page, keyword);
      const list = Array.isArray(data?.list) ? data.list : [];
      for (const obj of list) {
        const sn = obj.jobnoticeSn;
        const system = obj.systemKindCode || 'MRS2';
        const className = cleanText(obj.recruitClassName || '');
        const hostCompany = new URL(base).hostname.replace(/\.recruiter\.co\.kr$/i, '');
        const company = /^(수시|상시|경력|신입|인턴|특별채용|일반채용)$/i.test(className) ? hostCompany : (className || hostCompany);
        addJob(out, {
          title: obj.jobnoticeName,
          url: sn ? new URL(`/app/jobnotice/view?systemKindCode=${encodeURIComponent(system)}&jobnoticeSn=${encodeURIComponent(sn)}`, base).href : base,
          company,
          location: obj.workAreaName || obj.workPlaceName || '',
          description: [company, obj.recruitTypeName, obj.receiptState, obj.jobnoticeName].filter(Boolean).join(' '),
          postedAt: toEpochMsFromMidasDate(obj.applyStartDate),
          source: 'Recruiter',
        });
      }
    }
  }
  return out;
}

const source = argValue('--source', '').toLowerCase();
const max = Number(argValue('--max', '80')) || 80;
const keywords = parseKeywords();
if (!SOURCES.has(source)) {
  console.error(`Usage: node scripts/parsers/korea-job-board.mjs --source <${[...SOURCES].join('|')}> [--keywords a,b] [--max 80]`);
  process.exit(2);
}

const parsers = { jobkorea: parseJobKorea, saramin: parseSaramin, linkareer: parseLinkareer, catch: parseCatch, jasoseol: parseJasoseol, recruiter: parseRecruiter };
const map = await parsers[source](keywords);
const jobs = [...map.values()]
  .filter(j => j.title && j.url)
  .filter(isRelevantKoreaEe)
  .sort((a, b) => priorityScore(b) - priorityScore(a) || String(a.title).localeCompare(String(b.title), 'ko'))
  .slice(0, max);
console.log(JSON.stringify(jobs, null, 2));
