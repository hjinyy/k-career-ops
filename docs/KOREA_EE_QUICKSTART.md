# Korea EE Career-Ops Quickstart

This fork can run the original career-ops pipeline while evaluating postings for a
Korean electrical/electronic-engineering student or graduate.

## What changes

- Discovery is broad: internship, new-grad, full-time, contract, 채용연계형 인턴,
  산학장학생, 연구보조, 현장실습, Junior/Entry are all allowed into the pipeline.
- Korean-board collection now includes local zero-token parsers for JobKorea,
  Saramin, Linkareer, Catch, and Jasoseol where their public listing pages expose
  enough HTML/JSON.
- Official Korean large/mid-cap company coverage includes Samsung, SK, LG,
  Hyundai Motor Group/Mobis/AutoEver, Hanwha, POSCO, HD Hyundai, LS, Doosan,
  Lotte, CJ, Hyosung, Kolon, KT/NAVER/Kakao/Coupang infrastructure, DB/LX/Wonik,
  PSK, L&F, Hana Micron, EcoPro, HL, LIG Nex1, KAI, KCC, OCI, S-OIL, GS Energy,
  and related EE-heavy pages. Midas/recruiter.co.kr official pages with a public
  JSON list are scanned directly by the Korea parser; the remaining company
  career pages still appear as `Agent/WebSearch handoff` items with site-specific
  EE queries.
- Ranking prioritizes 신입/인턴/채용연계형/Junior/Entry/경력무관 postings and down-ranks
  hard 경력직, 영업/구매/공무, 단순 조립/생산직, 사무/행정, 조교/교수 matches.
- Evaluation is stricter: every posting is judged by **electrical-engineering
  major fit** and **broad student/graduate eligibility** before the normal career-ops
  score is finalized.
- Output is Korean-first and asks HR clarification questions when eligibility is
  ambiguous instead of guessing.

## Install the Korea EE lane

```bash
node setup-korea-ee.mjs
```

This copies tracked templates into the user layer:

| Template | Installed as |
|---|---|
| `templates/cv.korea-ee.template.md` | `cv.md` |
| `config/profile.korea-ee.example.yml` | `config/profile.yml` |
| `templates/portals.korea-ee.example.yml` | `portals.yml` |
| `modes/profile.korea-ee.template.md` | `modes/_profile.md` |
| `modes/custom.korea-ee.template.md` | `modes/_custom.md` |

Those installed files are intentionally gitignored by upstream career-ops because
they contain user-specific targeting. Keep editing them locally after setup.

Use `--force` only if you intentionally want to overwrite existing user-layer
customizations:

```bash
node setup-korea-ee.mjs --force
```

## Run checks

```bash
node doctor.mjs --json
node validate-portals.mjs --summary
node scan.mjs --dry-run --quiet
```

If `scan.mjs` prints `Agent/WebSearch handoff`, those entries are expected for
company career pages that do not expose a zero-token ATS/API feed. Use those
queries with your AI/web-search workflow, add confirmed posting URLs to
`data/pipeline.md`, then run the normal evaluation pipeline.

## Evaluation rubric overlay

Each report should surface:

- `전공 적합성:` ✅ 명확 / ⚠️ 가능성 있음 / ⛔ 부적합
- `지원자격:` ✅ 가능 / ⚠️ 확인 필요 / ⛔ 불가
- `고용형태:` 인턴 / 신입 / 정규직 / 계약직 / 채용연계형 / 산학장학생 / 기타 / 미상
- `오늘 액션:` 지원 / 저장 / HR 확인 / 제외

The existing A-G career-ops blocks remain intact; this overlay changes how fit is
interpreted for Korean electrical-engineering postings.
