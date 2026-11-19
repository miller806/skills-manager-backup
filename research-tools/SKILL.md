---
name: research-tools
description: "Research tools: arXiv paper search, blog/RSS monitoring (blogwatcher), LLM knowledge base (llm-wiki), prediction markets (Polymarket), and research paper writing."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [research, arxiv, blogwatcher, polymarket, paper writing, knowledge base, RSS]
    related_skills: [huggingface-hub, llm-inference]
---

# Research Tools

Five complementary tools for academic research, content monitoring, knowledge management, and paper writing.

| Section | Tool | Best For |
|---------|------|----------|
| **A: arXiv** | Paper search by keyword, author, category, ID | Finding academic papers, literature review, tracking new preprints |
| **B: Blogwatcher** | RSS/Atom feed monitoring | Tracking blogs, news sites, and RSS feeds for new content |
| **C: LLM Wiki** | Interlinked markdown knowledge base | Building and querying a personal/wiki-style knowledge base |
| **D: Polymarket** | Prediction market queries | Checking market prices, orderbooks, prediction history |
| **E: Paper Writing** | Academic paper authoring workflow | Structuring, drafting, and refining research papers |

---

## Section A: arXiv Paper Search

Search arXiv papers by keyword, author, category, or ID.

### Quick Usage

```bash
# Search by keyword
curl -s "http://export.arxiv.org/api/query?search_query=all:SEARCH+TERM&max_results=10"

# Search by author
curl -s "http://export.arxiv.org/api/query?search_query=au:AUTHOR_NAME&max_results=10"

# Search by category
curl -s "http://export.arxiv.org/api/query?search_query=cat:cs.AI&max_results=10"

# Get paper by ID
curl -s "http://export.arxiv.org/api/query?id_list=2401.12345"
```

### Common Categories

- `cs.AI` — Artificial Intelligence
- `cs.CL` — Computation and Language (NLP)
- `cs.CV` — Computer Vision
- `cs.LG` — Machine Learning
- `stat.ML` — Machine Learning (statistics)

---

## Section B: Blogwatcher (RSS Monitoring)

Monitor blogs and RSS/Atom feeds via the `blogwatcher-cli` tool.

### Setup

```bash
# Install
pip install blogwatcher-cli

# Add a feed
blogwatcher add "https://example.com/feed.xml"

# Check for new entries
blogwatcher check
```

### Common Workflows

1. **Add feeds to monitor:** Research blogs, news sites, personal blogs
2. **Check for updates:** Run periodically or via cron
3. **Filter by keywords:** Only show entries matching specific terms

---

## Section C: LLM Wiki (Knowledge Base)

Build and query an interlinked markdown knowledge base using Karpathy's LLM Wiki approach.

### Concept

A wiki-style knowledge base where each page is a markdown file, and pages are linked together. The LLM can traverse links to build context for answering questions.

### Workflow

1. **Create pages** as markdown files in a directory
2. **Add links** between related pages using `[[page name]]` syntax
3. **Query** the wiki to find relevant pages for a topic
4. **Traverse links** to gather comprehensive context

---

## Section D: Polymarket (Prediction Markets)

Query Polymarket for market data, prices, orderbooks, and history.

### API Access

```bash
# Get market info
curl -s "https://gamma-api.polymarket.com/events?slug=SLUG"

# Get market prices
curl -s "https://clob.polymarket.com/markets/MARKET_ID"

# Get orderbook
curl -s "https://clob.polymarket.com/book?market=MARKET_ID"
```

### Common Workflows

1. **Check market prices** for a specific prediction
2. **Monitor orderbook** depth and liquidity
3. **Track price history** for trend analysis

---

## Section E: Research Paper Writing

Workflow for authoring academic papers.

### Structure

Standard paper structure:
1. **Title** — Clear, specific, includes key terms
2. **Abstract** — Problem, method, results, significance (150-250 words)
3. **Introduction** — Context, problem, contribution, paper structure
4. **Related Work** — Survey of relevant literature
5. **Method** — Detailed description of approach
6. **Experiments** — Setup, results, analysis
7. **Conclusion** — Summary, limitations, future work
8. **References** — Properly formatted citations

### Writing Process

1. **Outline first** — Structure before writing prose
2. **Write method early** — It's the most concrete section
3. **Results with analysis** — Don't just present numbers, explain them
4. **Related work last** — Easier to position after you know your contribution
5. **Abstract last** — Write it after the paper is complete

### Templates

See `templates/` for starter paper templates in various formats.
