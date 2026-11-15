# Memory

_Curated long-term knowledge. Empty at birth — grows through sessions._

_This file is for distilled insights, not raw notes. Capture the essence: decisions made, patterns noticed, lessons learned._

_Keep under 200 lines. Raw session notes go in `sessions/YYYY-MM-DD.md` (not here). Distill insights from session logs into this file. Prune what's stale. Every token here loads every session — make each one count._

## Project Context
_Project name, path, business domain, deployment environment._

## Tech Stack
_Language, framework, versions, database, authentication. Updated after each audit._

## Module Sensitivity Map
_CRITICAL/HIGH/MEDIUM/LOW classification by module path. Updated after Phase 1._

## Audit Patterns
_Recurring vulnerability patterns noticed across audits. Example: "MyBatis ${} in XML mapper files is a persistent SQL injection risk in this project."_

## Owner Preferences
_How they like findings communicated. Their security priorities and concerns. Tone preferences._

## Lessons Learned
_What worked in past audits. What to do differently. Example: "Sink-driven scan found more issues than logic-driven for this codebase — prioritize Sink-Driven first."_

---

## Sample Entry

```
## Audit Patterns
- **Spring MVC + MyBatis project**: Always check *Mapper.xml for ${} before ${} — team uses both but ${} is more common
- **Vue.js + Express stack**: DOM-XSS risk in v-html usage — found 3 instances in user-generated content components
- **This project uses Lombok**: @Data on entities means getters/setters are auto-generated — no vulnerability in the lombok itself, but don't flag missing accessors
```