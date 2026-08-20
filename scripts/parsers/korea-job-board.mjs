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

const SOURCES = new Set(['jobkorea', 'saramin', 'linkareer', 'catch', 'jasoseol']);

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
  const negative = /마케팅|회계|재무|인사|총무|법무|공인노무사|IR|외환관리|자금조달|재무회계|학과사무실|행정직원|운영교수|교육조교|고객상담|고객센터|상담사|콜센터|영업관리|영업지원|사업 영업|구매 담당|자재구매|인허가 사무직|환경관리|경노무|미화|사무직원|사무보조|매장|조리|미용|간호|생활용품|화장품|의류|식품|쇼핑몰/i;
  return positive.test(text) && !negative.test(`${job.title || ''}`);
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

const source = argValue('--source', '').toLowerCase();
const max = Number(argValue('--max', '80')) || 80;
const keywords = parseKeywords();
if (!SOURCES.has(source)) {
  console.error(`Usage: node scripts/parsers/korea-job-board.mjs --source <${[...SOURCES].join('|')}> [--keywords a,b] [--max 80]`);
  process.exit(2);
}

const parsers = { jobkorea: parseJobKorea, saramin: parseSaramin, linkareer: parseLinkareer, catch: parseCatch, jasoseol: parseJasoseol };
const map = await parsers[source](keywords);
const jobs = [...map.values()]
  .filter(j => j.title && j.url)
  .filter(isRelevantKoreaEe)
  .slice(0, max);
console.log(JSON.stringify(jobs, null, 2));
