from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

from importlib.util import module_from_spec, spec_from_file_location


BASE = Path(r"C:\Users\Mohamed Yousuf\.codex\plugins\cache\openai-primary-runtime\documents\26.630.12135\skills\documents")
TABLE_GEOM_PATH = BASE / "scripts" / "table_geometry.py"
spec = spec_from_file_location("table_geometry", TABLE_GEOM_PATH)
table_geometry = module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(table_geometry)  # type: ignore[attr-defined]

OUTPUT = Path(r"C:\Code\AI Agent\MVP\code-review-ai-agent\ai-code-review-agent-sdd.docx")

BLACK = RGBColor(0, 0, 0)
NAVY = RGBColor(31, 77, 120)
BLUE = RGBColor(46, 116, 181)
GRAY = RGBColor(68, 68, 68)
LIGHT = "F2F4F7"
SOFT = "F7F9FC"


def set_font(run, *, name="Calibri", size=11, color=BLACK, bold=False, italic=False):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:ascii"), name)
    run._element.rPr.rFonts.set(qn("w:hAnsi"), name)
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.bold = bold
    run.italic = italic


def para(doc, text, *, size=11, color=BLACK, bold=False, italic=False, before=0, after=6, line=1.1, align=WD_ALIGN_PARAGRAPH.LEFT):
    p = doc.add_paragraph()
    p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    pf.line_spacing = line
    run = p.add_run(text)
    set_font(run, size=size, color=color, bold=bold, italic=italic)
    return p


def heading(doc, text, level=1):
    p = doc.add_heading(text, level=level)
    if level == 1:
        p.paragraph_format.space_before = Pt(16)
        p.paragraph_format.space_after = Pt(8)
    elif level == 2:
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(6)
    else:
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = 1.05
    return p


def bullet(doc, text):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = 1.1
    p.add_run(text)
    return p


def numbered(doc, text):
    p = doc.add_paragraph(style="List Number")
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = 1.1
    p.add_run(text)
    return p


def code_block(doc, text):
    for line in text.strip("\n").splitlines():
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.15)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0
        run = p.add_run(line)
        set_font(run, name="Courier New", size=9.5, color=GRAY)


def shade(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell(cell, text, *, bold=False, fill=None, size=10.5):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    p.paragraph_format.line_spacing = 1.05
    run = p.add_run(text)
    set_font(run, size=size, bold=bold)
    cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
    if fill:
        shade(cell, fill)


def make_table(doc, rows, widths, fill=LIGHT):
    table = doc.add_table(rows=len(rows), cols=len(rows[0]))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    for r, row in enumerate(rows):
        for c, value in enumerate(row):
            cell = table.rows[r].cells[c]
            if isinstance(value, tuple):
                text, bold = value
            else:
                text, bold = value, False
            set_cell(cell, text, bold=bold or r == 0, fill=fill if r == 0 else None)
    table_geometry.apply_table_geometry(
        table,
        widths,
        table_width_dxa=9360,
        indent_dxa=120,
        cell_margins_dxa={"top": 80, "bottom": 80, "start": 120, "end": 120},
    )
    return table


def page_number_footer(section):
    footer = section.footer
    p = footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1
    p.add_run("Page ")
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    r = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    r.append(t)
    fld.append(r)
    p._p.append(fld)


def add_page_break(doc):
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)


def build():
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = Inches(1)
    sec.bottom_margin = Inches(1)
    sec.left_margin = Inches(1)
    sec.right_margin = Inches(1)
    sec.header_distance = Inches(0.492)
    sec.footer_distance = Inches(0.492)
    sec.different_first_page_header_footer = True

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
    normal.font.size = Pt(11)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    normal.paragraph_format.line_spacing = 1.1

    for name, size, color in [("Heading 1", 16, BLUE), ("Heading 2", 13, BLUE), ("Heading 3", 12, NAVY)]:
        s = styles[name]
        s.font.name = "Calibri"
        s._element.rPr.rFonts.set(qn("w:ascii"), "Calibri")
        s._element.rPr.rFonts.set(qn("w:hAnsi"), "Calibri")
        s.font.size = Pt(size)
        s.font.color.rgb = color

    doc.core_properties.title = "AI Code Review Agent"
    doc.core_properties.author = "Mohamed Yousuf S"
    doc.core_properties.subject = "Software Design Document"

    # Cover
    para(doc, "AI Code Review Agent", size=26, bold=True, after=4, align=WD_ALIGN_PARAGRAPH.CENTER)
    para(doc, "Production-Ready AI-Powered Pull Request Review System", size=14, italic=True, color=GRAY, after=18, align=WD_ALIGN_PARAGRAPH.CENTER)
    para(doc, "Software Design Document", size=13, bold=True, color=NAVY, after=24, align=WD_ALIGN_PARAGRAPH.CENTER)
    cover = [
        ["Project Title", "AI Code Review Agent"],
        ["Document Type", "Software Design Document"],
        ["Version", "1.0"],
        ["Author", "Mohamed Yousuf S"],
        ["Date", "July 8, 2026"],
    ]
    make_table(doc, cover, [2400, 6960], fill=SOFT)
    para(doc, "Prepared for project submission, GitHub documentation, and interview presentation.", size=10.5, italic=True, color=GRAY, before=18, after=0, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_page_break(doc)

    # TOC
    para(doc, "Table of Contents", size=18, bold=True, after=12, align=WD_ALIGN_PARAGRAPH.CENTER)
    p = doc.add_paragraph()
    p.add_run("[[TOC]]")
    add_page_break(doc)

    heading(doc, "1. Project Overview", 1)
    para(doc, "AI Code Review Agent is a backend-only service that automates Pull Request review for GitHub repositories. It receives GitHub webhook events, verifies their authenticity, fetches only the changed files from the Pull Request, and uses Groq LLM to analyze the diff before posting review feedback back to GitHub.")
    para(doc, "The MVP is intentionally scoped to personal repositories so the core pipeline can be validated quickly, but the service boundaries, data model, and deployment approach are designed to grow into organization-level support without reworking the entire system.")
    para(doc, "The result is a repeatable review assistant that reduces review latency, improves consistency, and helps teams surface quality and security issues earlier in the development cycle.")

    heading(doc, "2. Problem Statement", 1)
    para(doc, "Manual Pull Request review is valuable, but it does not scale cleanly when a repository has frequent changes, multiple contributors, or security-sensitive code. Review time often depends on the availability and attention span of individual maintainers, which creates bottlenecks and uneven review quality.")
    for item in [
        "Delayed reviews slow down merge decisions and lengthen delivery cycles.",
        "Human oversight can miss edge cases, regressions, or risky changes in long diffs.",
        "Security vulnerabilities are easy to overlook when reviewers are focused on feature correctness.",
        "Code quality feedback is inconsistent when different reviewers apply different standards.",
        "Reviewer availability issues create queueing delays during busy periods, weekends, or handoffs.",
        "Delayed developer feedback makes it harder to fix issues while the context is still fresh.",
    ]:
        bullet(doc, item)

    heading(doc, "3. Proposed Solution", 1)
    para(doc, "The proposed solution combines GitHub App authentication, webhook-driven event ingestion, and Groq-based code analysis into a direct review pipeline. GitHub notifies the backend when a Pull Request is opened, synchronized, or reopened; the backend validates the request and processes the review immediately instead of delegating to a queue.")
    para(doc, "The service fetches the PR diff through the GitHub REST API, builds a focused prompt around the changed code, sends that prompt to Groq LLM, parses the structured review result, stores the findings, and posts a concise review comment back to the Pull Request.")
    for item in [
        "Fast feedback without introducing queue infrastructure for the MVP.",
        "Reviewing only changed code to keep analysis focused and efficient.",
        "Persisted findings for traceability, troubleshooting, and future reporting.",
        "A modular design that can add queueing, notifications, or dashboards later.",
    ]:
        bullet(doc, item)

    heading(doc, "4. Project Objectives", 1)
    heading(doc, "4.1 Primary Objectives", 2)
    for item in [
        "Automate Pull Request review for supported repositories.",
        "Improve code quality by surfacing maintainability and correctness issues.",
        "Detect security concerns earlier in the review cycle.",
        "Reduce the manual workload on human reviewers.",
        "Provide fast, actionable feedback to developers.",
    ]:
        bullet(doc, item)
    heading(doc, "4.2 Secondary Objectives", 2)
    for item in [
        "Build a modular backend architecture that is easy to test and extend.",
        "Make the system cloud-ready for AWS deployment.",
        "Allow future organization-level GitHub support without a redesign.",
        "Keep the architecture simple now while preserving clear service boundaries for future scaling.",
    ]:
        bullet(doc, item)

    heading(doc, "5. Project Scope", 1)
    heading(doc, "5.1 Current MVP Scope", 2)
    for item in [
        "Personal GitHub repository support.",
        "Pull Request event handling for opened, synchronized, and reopened events.",
        "AI-based review of the changed code only.",
        "GitHub comment posting back to the Pull Request conversation.",
    ]:
        bullet(doc, item)
    heading(doc, "5.2 Future Scope", 2)
    for item in [
        "Organization-wide repository support.",
        "Multiple LLM provider support with routing and fallback strategies.",
        "Slack notifications for review completion and critical findings.",
        "Jira integration for issue creation from actionable review items.",
        "Security scanner integration alongside the LLM review pipeline.",
        "A web dashboard for review history, metrics, and auditability.",
    ]:
        bullet(doc, item)

    heading(doc, "6. Technology Stack", 1)
    tech = [
        [("Layer", True), ("Technology", True), ("Purpose", True)],
        ["Backend", "Node.js", "Runtime for the API, webhook receiver, and review processing path."],
        ["Framework", "Express.js", "HTTP server and middleware layer for REST endpoints and GitHub webhooks."],
        ["Language", "TypeScript", "Type safety, maintainability, and safer refactoring."],
        ["AI", "Groq LLM", "Primary model provider for structured code review analysis."],
        ["GitHub Integration", "GitHub App, Webhooks, GitHub REST API", "Authenticates with GitHub, receives events, and posts comments."],
        ["Database", "PostgreSQL", "Persistent storage for repositories, findings, and webhook events."],
        ["ORM", "Prisma", "Schema management and type-safe database access."],
        ["Validation", "Zod", "Runtime input and payload validation."],
        ["Security", "Helmet, CORS, Rate Limiting", "Baseline API hardening and abuse protection."],
        ["Testing", "Jest", "Unit and integration testing framework."],
        ["Deployment", "AWS", "Cloud runtime, storage, secrets, and logging."],
    ]
    make_table(doc, tech, [1872, 3024, 4464])

    heading(doc, "7. High-Level Architecture", 1)
    para(doc, "The core processing path is intentionally direct so the webhook can be handled in one pass without extra infrastructure.")
    code_block(doc, """
GitHub Pull Request
|
v
GitHub Webhook
|
v
Node.js Express Backend
|
v
Webhook Verification
|
v
GitHub REST API ----> Fetch PR Files/Diff
|
v
Groq LLM ----> Analyze Code
|
v
Post Review Comment to GitHub PR
    """)
    para(doc, "GitHub sends the event to the webhook endpoint. The backend verifies the signature, persists the event, retrieves the PR diff and file list, builds the review prompt, calls Groq, and posts the review comment back to GitHub.")
    bullet(doc, "Webhook verification protects the ingestion endpoint from forged events.")
    bullet(doc, "The review flow remains compact and easy to reason about for the MVP.")
    bullet(doc, "Service boundaries still keep GitHub API calls, review orchestration, and persistence separated.")

    heading(doc, "8. Component Architecture", 1)
    comp = [
        [("Component", True), ("Role in the System", True)],
        ["GitHub App", "Provides installation-based authentication and scoped repository access."],
        ["Webhook Controller", "Receives GitHub events, validates headers, and hands off processing."],
        ["GitHub API Service", "Encapsulates installation token management and REST calls."],
        ["Groq AI Service", "Builds prompts, calls the model, and parses structured responses."],
        ["Review Orchestrator", "Coordinates the end-to-end review flow and error handling."],
        ["PostgreSQL Database", "Stores repository metadata, webhook history, review records, and findings."],
    ]
    make_table(doc, comp, [2496, 6864])
    para(doc, "The component split keeps the system testable: authentication, webhook handling, AI review, and comment posting are isolated behind dedicated services.")

    heading(doc, "9. Request Flow", 1)
    para(doc, "The request flow below shows the full lifecycle from developer action to posted review comment.")
    for item in [
        "Developer creates or updates a Pull Request.",
        "GitHub sends a webhook event to the backend.",
        "The backend verifies the event and persists it.",
        "The backend fetches the PR diff and changed files.",
        "Groq reviews the changed code and returns structured findings.",
        "Findings are saved in PostgreSQL.",
        "A review comment is posted or updated on the Pull Request.",
    ]:
        numbered(doc, item)
    code_block(doc, """
Developer creates PR
    -> GitHub sends webhook
    -> Backend verifies event
    -> Backend fetches PR diff
    -> Groq reviews code
    -> Findings saved in database
    -> Comment posted on PR
    """)

    heading(doc, "10. Project Folder Structure", 1)
    code_block(doc, """
ai-code-review-agent/
├── src/
│   ├── config/
│   │   ├── env.ts
│   │   └── database.ts
│   ├── app.ts
│   ├── server.ts
│   ├── routes/
│   │   ├── health.routes.ts
│   │   └── github.routes.ts
│   ├── controllers/
│   │   └── github.controller.ts
│   ├── services/
│   │   ├── github/
│   │   │   ├── auth.service.ts
│   │   │   ├── github-api.service.ts
│   │   │   └── github-comment.service.ts
│   │   ├── ai/
│   │   │   ├── groq.service.ts
│   │   │   ├── prompt-builder.service.ts
│   │   │   └── response-parser.service.ts
│   │   └── review/
│   │       ├── review-orchestrator.service.ts
│   │       └── review.service.ts
│   ├── middlewares/
│   │   ├── error.middleware.ts
│   │   ├── security.middleware.ts
│   │   └── raw-body.middleware.ts
│   ├── validators/
│   │   └── github.validator.ts
│   ├── utils/
│   │   ├── crypto.util.ts
│   │   ├── github.util.ts
│   │   └── text.util.ts
│   └── types/
│       ├── github.types.ts
│       └── review.types.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── tests/
│   ├── unit/
│   └── integration/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── README.md
└── eslint.config.js
    """)
    heading(doc, "10.1 Folder Purpose", 2)
    for item in [
        "`src/config` centralizes environment and database initialization.",
        "`src/services/github` handles authentication, API requests, and PR comments.",
        "`src/services/ai` builds prompts and parses Groq responses.",
        "`src/services/review` orchestrates the review pipeline end to end.",
        "`src/middlewares` contains security, error handling, and raw body capture logic.",
        "`prisma` holds the schema and migration history.",
        "`tests` contains unit and integration coverage.",
    ]:
        bullet(doc, item)

    heading(doc, "11. Database Design", 1)
    para(doc, "The database stores both durable GitHub domain objects and processing history so the system can recover from failures, avoid duplicate work, and support future reporting features.")
    code_block(doc, """
Repository
|
| 1:N
v
PullRequest
|
| 1:N
v
ReviewJob
|
| 1:N
v
ReviewFinding

WebhookEvent is used to store incoming webhook payloads and processing status.
    """)
    db = [
        [("Entity", True), ("Purpose", True), ("Notes", True)],
        ["Repository", "Represents a GitHub repository tracked by the service.", "Stores owner, name, installation metadata, and scope."],
        ["PullRequest", "Captures a specific PR and its current review state.", "Links to repository and GitHub PR identifiers."],
        ["ReviewJob", "Represents a review attempt and its status.", "Used for status tracking and orchestration."],
        ["ReviewFinding", "Stores the issues, recommendations, and severity returned by the LLM.", "Can support future dashboards and analytics."],
        ["WebhookEvent", "Stores incoming webhook payloads and processing status.", "Useful for debugging, auditability, and replay handling."],
    ]
    make_table(doc, db, [1880, 4100, 3380])
    para(doc, "Repository is the root entity for the MVP. PullRequest rows are associated to the repository, ReviewJob records capture each processing attempt, and ReviewFinding records preserve the structured review output. WebhookEvent retains raw event details so failures can be diagnosed after the fact.")

    heading(doc, "12. Processing Model", 1)
    para(doc, "For the MVP, the review happens inline after webhook verification so the system stays simple and easy to operate. The database still persists webhook events and review results for traceability, and the architecture keeps clear service boundaries so queue-based processing can be added later if traffic grows.")
    for item in [
        "Fast enough for the MVP because only changed files are reviewed.",
        "A simple execution path reduces setup and operational complexity.",
        "Failure handling still exists through persisted webhook and review records.",
        "The design can be extended to a queue later if traffic increases.",
    ]:
        bullet(doc, item)

    heading(doc, "13. AI Review Pipeline", 1)
    code_block(doc, "GitHub Diff -> Prompt Builder -> Groq LLM -> JSON Response -> Response Parser -> GitHub Comment Generator")
    para(doc, "The AI review is intentionally focused on the changed code only, not the full repository. This keeps token usage under control, reduces noise, and gives the model the exact context needed to comment on the Pull Request diff.")
    for item in [
        "Prompt Builder extracts the PR diff, metadata, and review rules.",
        "Groq LLM returns a structured JSON payload with findings and recommendations.",
        "Response Parser validates the JSON and converts it into application records.",
        "GitHub Comment Generator formats the result as a readable PR review summary.",
    ]:
        bullet(doc, item)

    heading(doc, "14. GitHub Integration", 1)
    for item in [
        "GitHub App authentication is used instead of personal access tokens so permissions are scoped and installable per repository.",
        "Installation access tokens are generated when the service needs to call the GitHub REST API.",
        "Webhook events are the entry point for opened, synchronized, and reopened Pull Requests.",
        "Pull Request APIs are used to list changed files, fetch diffs, and inspect metadata.",
        "Comment APIs are used to create or update the PR review feedback.",
        "Webhook signature verification ensures the request really came from GitHub.",
    ]:
        bullet(doc, item)
    para(doc, "The current MVP assumes personal repositories, but the same authentication pattern extends naturally to organization installations later.")

    heading(doc, "15. Security Architecture", 1)
    for item in [
        "Webhook signature verification prevents unauthorized webhook submission.",
        "Environment variable validation ensures required secrets are present at startup.",
        "Helmet adds common HTTP hardening headers.",
        "CORS is restricted so only approved clients can call the public API surface.",
        "Rate limiting reduces abuse and protects the webhook and health endpoints.",
        "Zod validation enforces request and payload structure at runtime.",
        "Least privilege GitHub App permissions reduce blast radius.",
        "Secrets are stored in environment variables or AWS Secrets Manager rather than in source control.",
    ]:
        bullet(doc, item)
    para(doc, "Security is applied at the edge, in request validation, in GitHub permission design, and in deployment practices so the system can be safely exposed to the internet.")

    heading(doc, "16. API Design", 1)
    api = [
        [("Method", True), ("Endpoint", True), ("Purpose", True)],
        ["GET", "/health", "Basic liveness check for the API process."],
        ["GET", "/ready", "Readiness check for dependencies such as the database."],
        ["POST", "/webhooks/github", "Receives GitHub Pull Request webhook events."],
    ]
    make_table(doc, api, [1728, 3360, 4272])
    para(doc, "The webhook endpoint should accept GitHub's raw request body so the signature can be verified before any parsing occurs.")

    heading(doc, "17. Deployment Architecture", 1)
    code_block(doc, """
GitHub
|
v
AWS EC2 / ECS
|
v
Node.js Express Backend
|
+--> RDS PostgreSQL
|
v
Groq API
    """)
    para(doc, "The deployment model is cloud-ready and keeps the runtime simple. On AWS, the API can run on EC2 or ECS, PostgreSQL can live in RDS, and secrets can be stored in AWS Secrets Manager.")
    bullet(doc, "EC2 or ECS runs the Node.js API as a normal service process.")
    bullet(doc, "RDS PostgreSQL stores durable application state and review history.")
    bullet(doc, "CloudWatch Logs provides application observability and troubleshooting visibility.")

    heading(doc, "18. Non-Functional Requirements", 1)
    for item in [
        "Scalability: the system should handle increasing PR volume through application-level optimizations and future extensibility.",
        "Reliability: persisted review and webhook state should allow safe recovery from transient failures.",
        "Security: webhook verification, validation, and least privilege permissions are mandatory.",
        "Maintainability: the codebase should remain modular and easy to test.",
        "Performance: webhook response time should stay fast because the review flow is focused on changed code only.",
        "Extensibility: future providers, integrations, and dashboards should slot into the existing architecture.",
        "Observability readiness: logs, records, and webhook persistence should support operational debugging.",
    ]:
        bullet(doc, item)

    heading(doc, "19. Future Enhancements", 1)
    for item in [
        "Organization-wide GitHub repository support.",
        "A dashboard for review history and operational visibility.",
        "Slack and Microsoft Teams notifications.",
        "Jira ticket creation from actionable findings.",
        "Multiple AI model support with provider selection.",
        "Static code analyzer integration alongside LLM review.",
        "Security scanner integration for dependency and code risk detection.",
        "A code quality score for quick signal at a glance.",
        "Historical analytics across repositories and pull requests.",
    ]:
        bullet(doc, item)

    heading(doc, "20. Conclusion", 1)
    para(doc, "AI Code Review Agent is designed as a scalable, production-ready AI-powered code review system rather than a one-off prototype. Its direct review architecture, modular service boundaries, and persistent review history make it practical for real GitHub workflows today while leaving room for growth later.")
    para(doc, "The MVP can start with personal repositories and deliver immediate value by accelerating feedback and improving review consistency. From there, the same foundation can expand to organization-level usage, richer integrations, and stronger analytics without replacing the core design.")

    page_number_footer(sec)
    doc.save(OUTPUT)


if __name__ == "__main__":
    build()
