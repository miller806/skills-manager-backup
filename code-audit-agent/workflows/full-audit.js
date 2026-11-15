/**
 * Code Audit Agent — 全量安全审计 Workflow（v4 抗中断版）
 *
 * 架构：Phase 1（侦察）→ Phase 2（7 个审计轨道并行）→ Phase 3（报告生成）
 *
 * 修复原版问题：
 *   原版：串行 await agent() × 9，任一中断 → 全部永久阻塞
 *   v4：   parallel() 并发执行，任一中断 → 其余继续，部分结果也生成报告
 *
 * v4 最佳实践：
 *   1. ✅ parallel() 启动独立 agent（不用串行 await）
 *   2. ✅ 每个 agent prompt 有明确停止条件
 *   3. ✅ 每个 agent 限制搜索范围（"只读这 N 个文件"）
 *   4. ✅ .filter(Boolean) 处理失败结果
 *   5. ✅ 报告 agent 检查 findings.length === 0 时提前返回
 *   6. ✅ 每个 agent 有时间上限提示（"Max 15 minutes"）
 *   7. ❌ 不让 agent 自行决定搜索深度
 *   8. ❌ 不用 "搜索所有 X 文件" 开放性指令
 *   9. ❌ 不在一个 agent 里做太多事
 *   10. ❌ 不依赖所有 agent 都成功才能出报告
 */

export const meta = {
  name: 'code-audit-full-v4',
  description: '全量代码安全审计（v4）— 并行执行 7 个审计轨道，每个有明确范围和停止条件，抗中断设计。',
  phases: [
    { title: '侦察', detail: '识别项目组件、技术栈' },
    { title: '并行审计', detail: '7 个审计轨道同时执行，每个有明确搜索范围和停止条件' },
    { title: '综合', detail: '汇总发现，生成报告' }
  ]
}

// ============================================================
// Phase 1: 侦察 — 单独执行，只读关键文件
// ============================================================
phase('侦察')

const recon = await agent(
  'Read these files ONLY — do not search beyond this list:\n' +
  '1. Root pom.xml or build.gradle (if exists)\n' +
  '2. All package.json files (if exist)\n' +
  '3. All application.yml / application.properties / bootstrap.yml files (if exist)\n' +
  '4. Any go.mod / requirements.txt / Cargo.toml / composer.json / *.csproj (if exist)\n' +
  '\n' +
  'Output a tech stack summary with: languages, frameworks, versions, databases, auth mechanisms, project structure.\n' +
  'After reading these files, STOP and output. Do not search further. Max 10 minutes.',
  { label: 'recon', phase: '侦察' }
)

// ============================================================
// Phase 2: 并行审计 — 7 个独立轨道，每个有明确范围和停止条件
// ============================================================
phase('并行审计')

const auditResults = await parallel([

  // ── 轨道 1: 认证安全（5 项检查，完成后停止）──
  () => agent(
    'Check exactly these 5 items in the project, then STOP:\n' +
    '\n' +
    '1) JWT expiration: Grep for "Jwts.builder" or "JwtBuilder". Read matching code (±30 lines). ' +
    '   Check if setExpiration() or .exp() is called. If grep finds nothing, report "not found" and move on.\n' +
    '2) Logout token invalidation: Grep for "@PostMapping.*logout" or "logout()" in Controllers. ' +
    '   Read matching code. Check if token blacklist or version control exists.\n' +
    '3) Filter/Interceptor whitelist: Grep for "Filter" and "Interceptor" class definitions. ' +
    '   Read the top 3 matching files. Check which paths are whitelisted (no auth required).\n' +
    '4) Actuator exposure: Read all yml/properties files for "management.endpoints". Check if exposed without auth.\n' +
    '5) CORS config: Grep for "CorsConfiguration" or "@CrossOrigin". Read matching code.\n' +
    '\n' +
    'After item 5, output findings IMMEDIATELY. Do NOT search beyond these 5 items.\n' +
    'ONLY report security vulnerabilities. Do NOT report functional bugs or performance issues.\n' +
    'Max 15 minutes.',
    { label: 'auth-audit', phase: '并行审计' }
  ),

  // ── 轨道 2: SQL 注入（只读 XML mapper + 注解）──
  () => agent(
    'Check SQL injection with these steps, then STOP:\n' +
    '\n' +
    '1) Find ALL *Mapper.xml files with Glob. Read EVERY XML file completely.\n' +
    '2) In each XML, find all ${} usages (direct SQL concatenation). ' +
    '   If NO ${} found in any XML, report "clean — no ${} in MyBatis XML" and STOP.\n' +
    '3) For each ${} found, read the calling Java method (search for the method name with Grep). ' +
    '   Check if the parameter is user-controllable (@RequestBody/@RequestParam/@PathVariable).\n' +
    '4) Grep for "@Select(" or "@Insert(" or "@Update(" or "@Delete(" annotations. ' +
    '   Read matching code. Check for string concatenation in SQL.\n' +
    '5) Grep for "Statement" or "createStatement" or "executeQuery" in Java files. ' +
    '   Read matching code. Check for string concatenation.\n' +
    '\n' +
    'After step 5, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 15 minutes.',
    { label: 'sql-audit', phase: '并行审计' }
  ),

  // ── 轨道 3: 越权漏洞（只读 Controller + 关键参数）──
  () => agent(
    'Check privilege escalation and IDOR with these steps, then STOP:\n' +
    '\n' +
    '1) Grep for "*Controller.java" files. List all found.\n' +
    '2) Read ALL Controller files. For each, list: HTTP method, path, @PreAuthorize/@Secured annotation (if any).\n' +
    '3) For endpoints with userId/roleId/menuId/deptId/merchantId/walletId/payeeId/fileId/orderId parameters: ' +
    '   Read the method body. Check if there is data ownership verification (WHERE user_id = current_user_id).\n' +
    '4) Check if admin/management endpoints are separated from regular user endpoints.\n' +
    '5) Check approval/rejection endpoints (grep for "reject" / "approve" / "audit"). ' +
    '   Read matching code. Check if approver permission is verified.\n' +
    '\n' +
    'After step 5, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 15 minutes.',
    { label: 'idor-audit', phase: '并行审计' }
  ),

  // ── 轨道 4: 业务逻辑（只查 6 个具体项）──
  () => agent(
    'Check exactly these 6 items, then STOP:\n' +
    '\n' +
    '1) Amount/price/quantity validation: Grep for "@RequestParam.*amount" / "@RequestParam.*price" / ' +
    '   "@RequestParam.*quantity" / "@RequestParam.*sort". Read matching code. ' +
    '   Check if backend validates > 0 and upper bounds.\n' +
    '2) Price calculation: Grep for "multiply" / "price.*quantity" / "totalAmount" in service/controller code. ' +
    '   Read matching code. Check if backend recalculates or trusts frontend amount.\n' +
    '3) Password verification bypass: Grep for "isPassed" / "verifySuccess" / "passwordCheck". ' +
    '   Read matching code. Check if server directly executes operation or returns status for frontend to decide.\n' +
    '4) Email/SMS rate limiting: Grep for "sendEmail" / "sendSms" / "sendCode". ' +
    '   Read matching code. Check for trim(), rate limiting, deduplication.\n' +
    '5) Status field whitelist: Grep for "setStatus" / "updateStatus". ' +
    '   Read matching code. Check if status values are whitelist-validated.\n' +
    '6) Race conditions: Grep for "SELECT.*COUNT.*WHERE.*name" or "checkName" / "checkUnique". ' +
    '   Read matching code. Check if there is a unique index or distributed lock.\n' +
    '\n' +
    'After item 6, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 15 minutes.',
    { label: 'logic-audit', phase: '并行审计' }
  ),

  // ── 轨道 5: 前端安全（只检查 2 个项目各 7 个模式）──
  () => agent(
    'For ALL frontend projects (Vue/React/Angular/etc), check these 7 patterns, then STOP:\n' +
    '\n' +
    '1) Grep: v-html | innerHTML | document.write | dangerouslySetInnerHTML. Read matches.\n' +
    '2) Grep: eval\\( | new Function\\( | setTimeout.*string. Read matches.\n' +
    '3) Grep: localStorage.*setItem.*token | sessionStorage.*token. Read matches.\n' +
    '4) Grep: router/index.ts | router/index.js | beforeEach. Read matches.\n' +
    '5) Grep: api.*interceptor | axios.*interceptor | request.*interceptor. Read matches.\n' +
    '6) Grep: password.*=.*["\'] | secret.*=.*["\'] | api_key.*=.*["\'] | apiKey.*=.*["\'] in JS/TS files. Read matches.\n' +
    '7) Grep: response\\.data\\.isPassed | res\\.data\\.success | .data\\.passed. Read matches.\n' +
    '\n' +
    'For each grep: if nothing found, report "not found" and move to next pattern.\n' +
    'After pattern 7, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 20 minutes.',
    { label: 'frontend-audit', phase: '并行审计' }
  ),

  // ── 轨道 6: 文件上传（只读 3 类组件 + Java 后端）──
  () => agent(
    'Check file upload security with these 4 steps, then STOP:\n' +
    '\n' +
    '1) Grep for "ReUpload" / "Upload" / "BtUploadFiles" in frontend files. ' +
    '   Read the top 3 matching component files.\n' +
    '2) Grep for "MultipartFile" / "upload" / "@PostMapping.*upload" in Java files. ' +
    '   Read the top 3 matching files.\n' +
    '3) In matching code, check: file type validation (extension whitelist? Content-Type? Magic Number?), ' +
    '   file size limits, storage location/naming (original filename or UUID?).\n' +
    '4) Check if uploaded files require authentication to access (grep for file download/access endpoints).\n' +
    '\n' +
    'After step 4, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 10 minutes.',
    { label: 'upload-audit', phase: '并行审计' }
  ),

  // ── 轨道 7: 配置安全（只检查 7 项，带停止条件）──
  () => agent(
    'Check exactly these 7 items, then STOP:\n' +
    '\n' +
    '1) Read ALL application.yml / bootstrap.yml / application.properties files. ' +
    '   Check for hardcoded passwords, database connection strings, Redis passwords.\n' +
    '2) Grep in Java files for: password.*=.*["\'] | secret.*=.*["\'] | apiKey.*=.*["\'] | token.*=.*["\']. ' +
    '   Read matching code. Max 5 files.\n' +
    '3) Read .gitignore files. Check if sensitive files are excluded (.env, *.pem, *.key, credentials).\n' +
    '4) Read logback-spring.xml / log4j2.xml. Check if sensitive data (passwords, tokens) is logged.\n' +
    '5) Grep for "nacos.core.auth.enabled" / "DruidStatViewServlet" / "spring-boot-admin". ' +
    '   Read matching config. Check if auth is enabled.\n' +
    '6) Grep for "/v2/api-docs" | "/v3/api-docs" | "/swagger-ui" | "EnableSwagger" | "springdoc". ' +
    '   Read matching code. Check if exposed without auth.\n' +
    '7) Check if database ports (3306/3307/5432) are exposed — grep for port configs in yml/properties.\n' +
    '\n' +
    'After item 7, output findings IMMEDIATELY. Do NOT search further.\n' +
    'ONLY report security vulnerabilities. Max 15 minutes.',
    { label: 'config-audit', phase: '并行审计' }
  ),

])

// ============================================================
// 处理结果：过滤 null，输出状态
// ============================================================
const validAudits = auditResults.filter(Boolean)

const labels = ['认证安全', 'SQL注入', '越权漏洞', '业务逻辑', '前端安全', '文件上传', '配置安全']
const statusLine = auditResults
  .map((r, i) => r ? `✅ ${labels[i]}` : `⚠️ ${labels[i]} (被中断)`)
  .join(' | ')

log(`审计状态: ${statusLine}`)
log(`有效结果: ${validAudits.length}/7`)

if (validAudits.length === 0) {
  return 'ERROR: 所有审计轨道均失败或被中断，无法生成报告。'
}

// ============================================================
// Phase 3: 报告生成 — 串行，依赖 Phase 1 + Phase 2 结果
// ============================================================
phase('综合')

const findings = [recon, ...validAudits].filter(Boolean)

const report = await agent(
  'Here are the audit findings from each track:\n\n' +
  '--- Recon ---\n' +
  (typeof recon === 'string' ? recon.substring(0, 3000) : JSON.stringify(recon).substring(0, 3000)) +
  '\n\n' +
  findings.slice(1).map((f, i) =>
    `--- ${labels[i]} ---\n` +
    (typeof f === 'string' ? f.substring(0, 5000) : JSON.stringify(f).substring(0, 5000))
  ).join('\n\n') +
  '\n\n' +
  'Based on the above findings, generate a comprehensive security audit report.\n' +
  '\n' +
  'Requirements:\n' +
  '1. Executive Summary with overall security rating and critical risk count\n' +
  '2. CRITICAL and HIGH vulnerabilities — each with: title, CWE, exact location (file:line), ' +
  '   description, attack scenario, call chain analysis, CVSS score, remediation with code examples\n' +
  '3. MEDIUM vulnerabilities — simplified format\n' +
  '4. LOW/INFO issues — batch listed\n' +
  '5. Prioritized remediation summary (P0 immediate, P1 short-term, P2 long-term)\n' +
  '\n' +
  'CRITICAL RULES:\n' +
  '- ONLY report SECURITY vulnerabilities (exploitable for confidentiality/integrity/availability).\n' +
  '- Do NOT report functional bugs, performance issues, code style problems, or architectural flaws.\n' +
  '- Every CRITICAL/HIGH finding MUST have a verified call chain from entry point to sink.\n' +
  '- For each finding, answer: "How can an attacker exploit this?" If you cannot answer, do NOT report it.\n' +
  '\n' +
  'Output as Markdown.',
  { label: 'report-generation', phase: '综合' }
)

return report
