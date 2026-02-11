/**
 * Golden test dataset for SHEEP extraction accuracy measurement.
 * Each entry is a hand-labeled conversation with expected extractions.
 *
 * @module sheep/tests/fixtures/golden-dataset
 */

// =============================================================================
// TYPES
// =============================================================================

export type GoldenTestCase = {
  id: string;
  /** Raw conversation text (simulating session content) */
  conversation: string;
  /** Expected facts to be extracted */
  expectedFacts: Array<{
    subject: string;
    predicate: string;
    object: string;
    /** Is this a required extraction or optional? */
    required: boolean;
  }>;
  /** Expected causal links */
  expectedCausalLinks: Array<{
    cause: string;
    effect: string;
    mechanism?: string;
    required: boolean;
  }>;
  /** Expected episode summary keywords */
  expectedKeywords: string[];
  /** Test category for reporting */
  category: "user_info" | "preferences" | "work" | "technical" | "causal" | "temporal" | "emotional" | "multi_session";
};

// =============================================================================
// GOLDEN DATASET
// =============================================================================

export const GOLDEN_DATASET: GoldenTestCase[] = [
  // ===== USER INFORMATION =====
  {
    id: "user-001",
    conversation: `User: Hi! My name is Alex Chen and I work at TechCorp as a senior engineer.
Assistant: Nice to meet you, Alex! What kind of engineering work do you do at TechCorp?
User: Mostly backend stuff. I've been there for about 3 years now.`,
    expectedFacts: [
      { subject: "user", predicate: "has_name", object: "Alex Chen", required: true },
      { subject: "user", predicate: "works_at", object: "TechCorp", required: true },
      { subject: "user", predicate: "is_a", object: "senior engineer", required: true },
      { subject: "user", predicate: "works_on", object: "backend", required: false },
      { subject: "user", predicate: "tenure", object: "3 years", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["name", "work", "engineer", "TechCorp"],
    category: "user_info",
  },
  {
    id: "user-002",
    conversation: `User: I live in San Francisco but I'm originally from Seattle.
Assistant: Great cities! How long have you been in SF?
User: About 5 years now. Moved here for the job.`,
    expectedFacts: [
      { subject: "user", predicate: "lives_in", object: "San Francisco", required: true },
      { subject: "user", predicate: "from", object: "Seattle", required: true },
      { subject: "user", predicate: "time_in_sf", object: "5 years", required: false },
      { subject: "user", predicate: "moved_for", object: "job", required: false },
    ],
    expectedCausalLinks: [
      { cause: "job opportunity", effect: "moved to San Francisco", required: false },
    ],
    expectedKeywords: ["San Francisco", "Seattle", "move"],
    category: "user_info",
  },
  {
    id: "user-003",
    conversation: `User: I have two kids, Emma who is 7 and Jake who is 4.
Assistant: That's a fun age gap! Are they in school?
User: Yes, Emma is in second grade and Jake just started preschool.`,
    expectedFacts: [
      { subject: "user", predicate: "has_child", object: "Emma", required: true },
      { subject: "user", predicate: "has_child", object: "Jake", required: true },
      { subject: "Emma", predicate: "age", object: "7", required: true },
      { subject: "Jake", predicate: "age", object: "4", required: true },
      { subject: "Emma", predicate: "grade", object: "second grade", required: false },
      { subject: "Jake", predicate: "school", object: "preschool", required: false },
      { subject: "user", predicate: "number_of_children", object: "2", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["kids", "Emma", "Jake", "school"],
    category: "user_info",
  },
  {
    id: "user-004",
    conversation: `User: My email is sarah.j.miller@company.com and my phone is 555-123-4567.
Assistant: Got it, I'll save those contact details.
User: Actually, my work email is different - use sarah.miller@workcompany.io for professional stuff.`,
    expectedFacts: [
      { subject: "user", predicate: "has_name", object: "Sarah Miller", required: false },
      { subject: "user", predicate: "email", object: "sarah.j.miller@company.com", required: true },
      { subject: "user", predicate: "phone", object: "555-123-4567", required: true },
      {
        subject: "user",
        predicate: "work_email",
        object: "sarah.miller@workcompany.io",
        required: true,
      },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["email", "phone", "contact"],
    category: "user_info",
  },
  {
    id: "user-005",
    conversation: `User: I'm 34 years old and my birthday is March 15th.
Assistant: Oh nice, a fellow Pisces! Do you usually celebrate?
User: Not really, maybe just dinner with family.`,
    expectedFacts: [
      { subject: "user", predicate: "age", object: "34", required: true },
      { subject: "user", predicate: "birthday", object: "March 15", required: true },
      { subject: "user", predicate: "zodiac", object: "Pisces", required: false },
      { subject: "user", predicate: "celebration", object: "dinner with family", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["birthday", "age", "March"],
    category: "user_info",
  },

  // ===== PREFERENCES =====
  {
    id: "pref-001",
    conversation: `User: I really prefer TypeScript over JavaScript. The type safety is worth it.
Assistant: I agree, TypeScript's type system catches a lot of bugs early.
User: Exactly! I also like using Bun instead of Node for the speed.`,
    expectedFacts: [
      { subject: "user", predicate: "prefers", object: "TypeScript", required: true },
      { subject: "user", predicate: "prefers", object: "Bun", required: true },
      { subject: "user", predicate: "values", object: "type safety", required: false },
    ],
    expectedCausalLinks: [
      {
        cause: "type safety",
        effect: "prefers TypeScript",
        mechanism: "catches bugs early",
        required: true,
      },
      { cause: "speed", effect: "prefers Bun over Node", required: false },
    ],
    expectedKeywords: ["TypeScript", "JavaScript", "Bun", "type safety"],
    category: "preferences",
  },
  {
    id: "pref-002",
    conversation: `User: I hate using Jira. It's so slow and clunky.
Assistant: Many developers feel that way. Do you use something else?
User: We switched to Linear last month and it's so much better.`,
    expectedFacts: [
      { subject: "user", predicate: "dislikes", object: "Jira", required: true },
      { subject: "user", predicate: "uses", object: "Linear", required: true },
      { subject: "user", predicate: "switched_from", object: "Jira to Linear", required: false },
    ],
    expectedCausalLinks: [
      { cause: "Jira being slow and clunky", effect: "switched to Linear", required: true },
    ],
    expectedKeywords: ["Jira", "Linear", "switched"],
    category: "preferences",
  },
  {
    id: "pref-003",
    conversation: `User: I'm a vim user. Been using it for 10 years and can't switch now.
Assistant: The muscle memory is real! Do you use any particular plugins?
User: Yeah, I use vim-fugitive for git and fzf for fuzzy finding.`,
    expectedFacts: [
      { subject: "user", predicate: "uses", object: "vim", required: true },
      { subject: "user", predicate: "uses", object: "vim-fugitive", required: true },
      { subject: "user", predicate: "uses", object: "fzf", required: true },
      { subject: "user", predicate: "vim_experience", object: "10 years", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["vim", "plugins", "fugitive", "fzf"],
    category: "preferences",
  },
  {
    id: "pref-004",
    conversation: `User: I prefer dark mode for everything. Light themes hurt my eyes.
Assistant: Dark mode is definitely easier on the eyes, especially at night.
User: Exactly. I even use dark mode on my phone and browser.`,
    expectedFacts: [
      { subject: "user", predicate: "prefers", object: "dark mode", required: true },
      { subject: "user", predicate: "dislikes", object: "light themes", required: false },
    ],
    expectedCausalLinks: [
      { cause: "light themes hurt eyes", effect: "prefers dark mode", required: true },
    ],
    expectedKeywords: ["dark mode", "light themes", "eyes"],
    category: "preferences",
  },
  {
    id: "pref-005",
    conversation: `User: I love working from home. The commute was killing me before.
Assistant: How long was your commute?
User: About 90 minutes each way. Now I have 3 extra hours every day.`,
    expectedFacts: [
      { subject: "user", predicate: "prefers", object: "remote work", required: true },
      { subject: "user", predicate: "previous_commute", object: "90 minutes", required: false },
    ],
    expectedCausalLinks: [
      { cause: "long commute", effect: "prefers working from home", required: true },
    ],
    expectedKeywords: ["remote", "commute", "home"],
    category: "preferences",
  },
  {
    id: "pref-006",
    conversation: `User: I don't like Python's significant whitespace. I find it annoying.
Assistant: That's a common criticism. Do you prefer languages with braces?
User: Yes, I prefer Go or Rust where the structure is more explicit.`,
    expectedFacts: [
      {
        subject: "user",
        predicate: "dislikes",
        object: "Python significant whitespace",
        required: true,
      },
      { subject: "user", predicate: "prefers", object: "Go", required: true },
      { subject: "user", predicate: "prefers", object: "Rust", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Python", "whitespace", "Go", "Rust"],
    category: "preferences",
  },

  // ===== EMOTIONAL (stress, excitement, frustration) =====
  {
    id: "emo-001",
    conversation: `User: I'm so stressed about the release. We're 2 days behind and the client is getting impatient.
Assistant: That sounds really tough. What's the main blocker?
User: The API keeps failing under load. I've been debugging for 12 hours straight.`,
    expectedFacts: [
      { subject: "user", predicate: "feeling", object: "stressed", required: true },
      { subject: "release", predicate: "status", object: "2 days behind", required: true },
      { subject: "client", predicate: "feeling", object: "impatient", required: false },
      { subject: "API", predicate: "issue", object: "failing under load", required: true },
    ],
    expectedCausalLinks: [
      { cause: "release delay", effect: "client impatience", required: false },
      { cause: "API failures", effect: "stress and long debugging", required: true },
    ],
    expectedKeywords: ["stressed", "release", "API", "debugging"],
    category: "emotional",
  },
  {
    id: "emo-002",
    conversation: `User: I just got the promotion! I've been working toward this for 3 years!
Assistant: Congratulations! That's amazing news.
User: I can't believe it. My manager said I was the top performer on the team.`,
    expectedFacts: [
      { subject: "user", predicate: "got", object: "promotion", required: true },
      { subject: "user", predicate: "worked_toward", object: "promotion for 3 years", required: false },
      { subject: "user", predicate: "ranked", object: "top performer", required: true },
    ],
    expectedCausalLinks: [
      { cause: "top performer ranking", effect: "got promotion", required: true },
    ],
    expectedKeywords: ["promotion", "3 years", "top performer"],
    category: "emotional",
  },
  {
    id: "emo-003",
    conversation: `User: I'm so frustrated with this bug. It only happens in production and I can't reproduce it locally.
Assistant: Intermittent production bugs are the worst. Any leads?
User: I think it's a race condition. We added logging and should see it in the next deploy.`,
    expectedFacts: [
      { subject: "user", predicate: "feeling", object: "frustrated", required: true },
      { subject: "bug", predicate: "occurs_in", object: "production only", required: true },
      { subject: "bug", predicate: "suspected_cause", object: "race condition", required: true },
    ],
    expectedCausalLinks: [
      { cause: "race condition", effect: "intermittent production bug", required: true },
    ],
    expectedKeywords: ["frustrated", "bug", "production", "race condition"],
    category: "emotional",
  },
  {
    id: "emo-004",
    conversation: `User: I'm really excited about the new project. We're building something no one has done before.
Assistant: Innovation is thrilling! What makes it unique?
User: We're combining quantum computing with ML for real-time optimization. The team is incredible.`,
    expectedFacts: [
      { subject: "user", predicate: "feeling", object: "excited", required: true },
      { subject: "project", predicate: "novelty", object: "no one has done before", required: false },
      { subject: "project", predicate: "uses", object: "quantum computing and ML", required: true },
      { subject: "team", predicate: "quality", object: "incredible", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["excited", "quantum", "ML", "optimization"],
    category: "emotional",
  },
  {
    id: "emo-005",
    conversation: `User: I'm burned out. Three weeks of 60-hour weeks and the deadline got moved up again.
Assistant: That's unsustainable. Have you talked to your manager?
User: I tried. They said everyone is in the same boat. I'm considering taking a leave.`,
    expectedFacts: [
      { subject: "user", predicate: "state", object: "burned out", required: true },
      { subject: "user", predicate: "worked", object: "60 hours per week for 3 weeks", required: true },
      { subject: "user", predicate: "considering", object: "taking a leave", required: true },
    ],
    expectedCausalLinks: [
      { cause: "60-hour weeks and moved deadline", effect: "burnout", required: true },
    ],
    expectedKeywords: ["burned out", "deadline", "leave"],
    category: "emotional",
  },

  // ===== WORK/PROJECTS =====
  {
    id: "work-001",
    conversation: `User: I'm working on a new project called Moltbot. It's a personal AI assistant.
Assistant: Sounds interesting! What technologies are you using?
User: It's built with TypeScript, uses SQLite for storage, and connects to multiple LLM providers.`,
    expectedFacts: [
      { subject: "user", predicate: "working_on", object: "Moltbot", required: true },
      { subject: "Moltbot", predicate: "is_a", object: "personal AI assistant", required: true },
      { subject: "Moltbot", predicate: "uses", object: "TypeScript", required: true },
      { subject: "Moltbot", predicate: "uses", object: "SQLite", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Moltbot", "AI", "TypeScript", "SQLite"],
    category: "work",
  },
  {
    id: "work-002",
    conversation: `User: The deadline for the API redesign is next Friday. We need to finish the authentication module first.
Assistant: That's tight. What's blocking the auth module?
User: We're waiting on the security review. Once that's done, we can merge.`,
    expectedFacts: [
      { subject: "API redesign", predicate: "deadline", object: "next Friday", required: true },
      {
        subject: "authentication module",
        predicate: "status",
        object: "in progress",
        required: false,
      },
    ],
    expectedCausalLinks: [
      { cause: "security review pending", effect: "auth module blocked", required: true },
      { cause: "auth module completion", effect: "can proceed with API redesign", required: false },
    ],
    expectedKeywords: ["deadline", "API", "authentication", "security review"],
    category: "work",
  },
  {
    id: "work-003",
    conversation: `User: My team uses a microservices architecture. We have about 15 services.
Assistant: That's a good number. How do you handle service discovery?
User: We use Consul for service discovery and Kong for API gateway.`,
    expectedFacts: [
      { subject: "team", predicate: "uses", object: "microservices architecture", required: true },
      { subject: "team", predicate: "service_count", object: "15", required: false },
      { subject: "team", predicate: "uses", object: "Consul", required: true },
      { subject: "team", predicate: "uses", object: "Kong", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["microservices", "Consul", "Kong", "services"],
    category: "work",
  },
  {
    id: "work-004",
    conversation: `User: I'm the tech lead for a team of 6 engineers.
Assistant: Nice team size! What's your main product?
User: We build the payments platform. We process about $10M in transactions daily.`,
    expectedFacts: [
      { subject: "user", predicate: "role", object: "tech lead", required: true },
      { subject: "user", predicate: "team_size", object: "6 engineers", required: true },
      { subject: "team", predicate: "builds", object: "payments platform", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["tech lead", "team", "payments", "transactions"],
    category: "work",
  },
  {
    id: "work-005",
    conversation: `User: We just migrated from AWS to GCP last quarter.
Assistant: That's a big undertaking. What motivated the switch?
User: The BigQuery pricing was much better for our data analytics workloads.`,
    expectedFacts: [
      { subject: "team", predicate: "uses", object: "GCP", required: true },
      { subject: "team", predicate: "previous_cloud", object: "AWS", required: false },
      { subject: "team", predicate: "uses", object: "BigQuery", required: true },
    ],
    expectedCausalLinks: [
      { cause: "BigQuery pricing", effect: "migrated from AWS to GCP", required: true },
    ],
    expectedKeywords: ["AWS", "GCP", "migration", "BigQuery"],
    category: "work",
  },
  {
    id: "work-006",
    conversation: `User: Our sprint planning is every Monday at 10 AM.
Assistant: Standard timing. How long are your sprints?
User: Two weeks. We have retrospectives every other Friday.`,
    expectedFacts: [
      { subject: "team", predicate: "sprint_planning", object: "Monday 10 AM", required: true },
      { subject: "team", predicate: "sprint_length", object: "two weeks", required: true },
      {
        subject: "team",
        predicate: "retrospective",
        object: "every other Friday",
        required: false,
      },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["sprint", "planning", "retrospective"],
    category: "work",
  },

  // ===== TECHNICAL =====
  {
    id: "tech-001",
    conversation: `User: The database query is taking too long. It's doing a full table scan.
Assistant: Have you checked if there's an index on the query columns?
User: Good point. I added an index on user_id and the query went from 2s to 50ms.`,
    expectedFacts: [
      { subject: "database", predicate: "had_issue", object: "full table scan", required: false },
      { subject: "solution", predicate: "was", object: "add index on user_id", required: true },
      { subject: "query", predicate: "original_time", object: "2 seconds", required: false },
      { subject: "query", predicate: "optimized_time", object: "50ms", required: false },
    ],
    expectedCausalLinks: [
      {
        cause: "added index on user_id",
        effect: "query time reduced from 2s to 50ms",
        mechanism: "eliminated full table scan",
        required: true,
      },
    ],
    expectedKeywords: ["database", "index", "query", "performance"],
    category: "technical",
  },
  {
    id: "tech-002",
    conversation: `User: We're getting rate limited by the OpenAI API. Too many requests.
Assistant: You might want to implement request batching or add a queue.
User: Yeah, I added a rate limiter with exponential backoff and it fixed the issue.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "OpenAI API", required: true },
      {
        subject: "solution",
        predicate: "was",
        object: "rate limiter with exponential backoff",
        required: true,
      },
      { subject: "project", predicate: "had_issue", object: "rate limited by OpenAI", required: false },
    ],
    expectedCausalLinks: [
      { cause: "too many requests", effect: "rate limited by OpenAI API", required: true },
      {
        cause: "added rate limiter with exponential backoff",
        effect: "fixed rate limiting issue",
        required: true,
      },
    ],
    expectedKeywords: ["rate limit", "OpenAI", "backoff"],
    category: "technical",
  },
  {
    id: "tech-003",
    conversation: `User: Our Docker images are huge, over 2GB each.
Assistant: Multi-stage builds can help reduce that significantly.
User: Yeah, I rewrote the Dockerfile with multi-stage and got it down to 200MB.`,
    expectedFacts: [
      { subject: "docker_image", predicate: "original_size", object: "2GB", required: false },
      { subject: "docker_image", predicate: "optimized_size", object: "200MB", required: false },
      { subject: "solution", predicate: "was", object: "multi-stage builds", required: true },
    ],
    expectedCausalLinks: [
      {
        cause: "multi-stage builds",
        effect: "reduced Docker image from 2GB to 200MB",
        required: true,
      },
    ],
    expectedKeywords: ["Docker", "image", "multi-stage", "size"],
    category: "technical",
  },
  {
    id: "tech-004",
    conversation: `User: The memory leak was in the event listeners. We weren't cleaning them up.
Assistant: Ah, classic issue with React components. Did you fix it with useEffect cleanup?
User: Yes, I added the cleanup function in useEffect and the memory is stable now.`,
    expectedFacts: [
      { subject: "bug", predicate: "type", object: "memory leak", required: true },
      {
        subject: "bug",
        predicate: "cause",
        object: "event listeners not cleaned up",
        required: true,
      },
      {
        subject: "solution",
        predicate: "was",
        object: "useEffect cleanup function",
        required: true,
      },
    ],
    expectedCausalLinks: [
      { cause: "event listeners not cleaned up", effect: "memory leak", required: true },
      { cause: "added useEffect cleanup", effect: "memory is stable", required: true },
    ],
    expectedKeywords: ["memory leak", "event listeners", "useEffect", "React"],
    category: "technical",
  },
  {
    id: "tech-005",
    conversation: `User: We use PostgreSQL with pgvector for our embeddings.
Assistant: Nice choice! How many vectors are you storing?
User: About 5 million vectors. We have an HNSW index for fast approximate search.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "PostgreSQL", required: true },
      { subject: "project", predicate: "uses", object: "pgvector", required: true },
      { subject: "project", predicate: "vector_count", object: "5 million", required: false },
      { subject: "project", predicate: "uses", object: "HNSW index", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["PostgreSQL", "pgvector", "embeddings", "HNSW"],
    category: "technical",
  },
  {
    id: "tech-006",
    conversation: `User: The CI pipeline was taking 45 minutes. Way too long.
Assistant: What was taking most of the time?
User: The tests. I parallelized them across 4 workers and now it's down to 12 minutes.`,
    expectedFacts: [
      {
        subject: "CI pipeline",
        predicate: "original_duration",
        object: "45 minutes",
        required: false,
      },
      {
        subject: "CI pipeline",
        predicate: "optimized_duration",
        object: "12 minutes",
        required: false,
      },
      {
        subject: "solution",
        predicate: "was",
        object: "parallelized tests across 4 workers",
        required: true,
      },
    ],
    expectedCausalLinks: [
      {
        cause: "parallelized tests",
        effect: "CI pipeline reduced from 45 to 12 minutes",
        required: true,
      },
    ],
    expectedKeywords: ["CI", "pipeline", "tests", "parallelized"],
    category: "technical",
  },
  {
    id: "tech-007",
    conversation: `User: We're using Redis for session storage and caching.
Assistant: How much data are you caching?
User: About 50GB. We have a cluster with 3 primaries and 3 replicas.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "Redis", required: true },
      {
        subject: "Redis",
        predicate: "use_case",
        object: "session storage and caching",
        required: true,
      },
      { subject: "Redis", predicate: "data_size", object: "50GB", required: false },
      {
        subject: "Redis",
        predicate: "cluster_config",
        object: "3 primaries and 3 replicas",
        required: false,
      },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Redis", "session", "caching", "cluster"],
    category: "technical",
  },

  // ===== CAUSAL REASONING =====
  {
    id: "causal-001",
    conversation: `User: The deployment failed because the environment variable wasn't set.
Assistant: Ah, that's a common gotcha. Did you fix it?
User: Yes, I added it to the .env file and redeployed. Works now.`,
    expectedFacts: [],
    expectedCausalLinks: [
      { cause: "environment variable not set", effect: "deployment failed", required: true },
      { cause: "added env variable and redeployed", effect: "deployment works", required: true },
    ],
    expectedKeywords: ["deployment", "environment variable", "failed"],
    category: "causal",
  },
  {
    id: "causal-002",
    conversation: `User: After switching from REST to GraphQL, our mobile app's battery usage improved significantly.
Assistant: That makes sense - you're probably fetching only the data you need now.
User: Exactly. We reduced the number of API calls by 60% since we can batch queries.`,
    expectedFacts: [{ subject: "project", predicate: "uses", object: "GraphQL", required: true }],
    expectedCausalLinks: [
      { cause: "switched to GraphQL", effect: "mobile app battery usage improved", required: true },
      {
        cause: "GraphQL allows batching queries",
        effect: "reduced API calls by 60%",
        required: true,
      },
    ],
    expectedKeywords: ["GraphQL", "REST", "battery", "API calls"],
    category: "causal",
  },
  {
    id: "causal-003",
    conversation: `User: The page load time dropped to 1 second after we added code splitting.
Assistant: Nice improvement! What was it before?
User: Almost 5 seconds. The main bundle was 3MB, now it loads on demand.`,
    expectedFacts: [
      { subject: "page", predicate: "original_load_time", object: "5 seconds", required: false },
      { subject: "page", predicate: "optimized_load_time", object: "1 second", required: false },
    ],
    expectedCausalLinks: [
      {
        cause: "added code splitting",
        effect: "page load time dropped to 1 second",
        required: true,
      },
      { cause: "3MB bundle", effect: "slow 5 second page load", required: false },
    ],
    expectedKeywords: ["page load", "code splitting", "bundle", "performance"],
    category: "causal",
  },
  {
    id: "causal-004",
    conversation: `User: Our error rate spiked because of a bad deploy.
Assistant: Did you roll back?
User: Yes, rolled back immediately and the errors stopped. Found a null pointer bug.`,
    expectedFacts: [
      { subject: "bug", predicate: "type", object: "null pointer", required: false },
    ],
    expectedCausalLinks: [
      { cause: "bad deploy", effect: "error rate spiked", required: true },
      { cause: "null pointer bug", effect: "errors in production", required: true },
      { cause: "rollback", effect: "errors stopped", required: true },
    ],
    expectedKeywords: ["error", "deploy", "rollback", "bug"],
    category: "causal",
  },
  {
    id: "causal-005",
    conversation: `User: Adding compression reduced our bandwidth costs by 40%.
Assistant: What compression algorithm did you use?
User: Brotli for static assets and gzip for dynamic content.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "Brotli", required: true },
      { subject: "project", predicate: "uses", object: "gzip", required: true },
    ],
    expectedCausalLinks: [
      { cause: "added compression", effect: "reduced bandwidth costs by 40%", required: true },
    ],
    expectedKeywords: ["compression", "Brotli", "gzip", "bandwidth"],
    category: "causal",
  },
  {
    id: "causal-006",
    conversation: `User: Users were complaining about slow search. It was hitting the database directly.
Assistant: Adding a search index would help.
User: Yeah, I added Elasticsearch and search is now instant. Users are happy.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "Elasticsearch", required: true },
    ],
    expectedCausalLinks: [
      { cause: "search hitting database directly", effect: "slow search", required: true },
      { cause: "added Elasticsearch", effect: "search is instant", required: true },
    ],
    expectedKeywords: ["search", "Elasticsearch", "slow", "database"],
    category: "causal",
  },

  // ===== TEMPORAL =====
  {
    id: "temp-001",
    conversation: `User: Remember last week when we discussed the database migration?
Assistant: Yes, you were concerned about downtime.
User: Right. Well, we did it yesterday and it only took 30 minutes with zero downtime.`,
    expectedFacts: [
      {
        subject: "database migration",
        predicate: "completed",
        object: "yesterday",
        required: true,
      },
      {
        subject: "database migration",
        predicate: "duration",
        object: "30 minutes",
        required: false,
      },
      { subject: "database migration", predicate: "downtime", object: "zero", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["database", "migration", "downtime"],
    category: "temporal",
  },
  {
    id: "temp-002",
    conversation: `User: The feature was released on January 15th.
Assistant: How has adoption been?
User: Great! We hit 10,000 users within the first week.`,
    expectedFacts: [
      { subject: "feature", predicate: "release_date", object: "January 15", required: true },
      { subject: "feature", predicate: "users_first_week", object: "10,000", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["release", "January", "adoption", "users"],
    category: "temporal",
  },
  {
    id: "temp-003",
    conversation: `User: I started learning Rust 6 months ago.
Assistant: How's it going?
User: Good! I built my first production service with it last month.`,
    expectedFacts: [
      { subject: "user", predicate: "started_learning", object: "Rust", required: true },
      { subject: "user", predicate: "learning_duration", object: "6 months", required: false },
      { subject: "user", predicate: "built_first_service", object: "last month", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Rust", "learning", "production", "service"],
    category: "temporal",
  },
  {
    id: "temp-004",
    conversation: `User: The incident happened at 3 AM on Saturday. We fixed it by 5 AM.
Assistant: That's a quick turnaround. What was the root cause?
User: A certificate expired. We've now automated certificate renewal.`,
    expectedFacts: [
      { subject: "incident", predicate: "time", object: "3 AM Saturday", required: true },
      { subject: "incident", predicate: "resolution_time", object: "5 AM", required: false },
      {
        subject: "incident",
        predicate: "root_cause",
        object: "certificate expired",
        required: true,
      },
    ],
    expectedCausalLinks: [
      { cause: "certificate expired", effect: "incident at 3 AM", required: true },
    ],
    expectedKeywords: ["incident", "certificate", "Saturday", "fixed"],
    category: "temporal",
  },
  {
    id: "temp-005",
    conversation: `User: We're planning to deprecate the v1 API by Q2 next year.
Assistant: That gives users time to migrate. What's the replacement?
User: v2 API which we launched in October.`,
    expectedFacts: [
      { subject: "v1 API", predicate: "deprecation_date", object: "Q2 next year", required: true },
      { subject: "v2 API", predicate: "launch_date", object: "October", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["API", "deprecate", "v1", "v2", "October"],
    category: "temporal",
  },
  {
    id: "temp-006",
    conversation: `User: The contract renewal is due on March 1st.
Assistant: That's coming up. Are you planning to renew?
User: Yes, but we want to negotiate better terms. We've been customers for 3 years.`,
    expectedFacts: [
      { subject: "contract", predicate: "renewal_date", object: "March 1st", required: true },
      { subject: "user", predicate: "customer_duration", object: "3 years", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["contract", "renewal", "March", "negotiate"],
    category: "temporal",
  },

  // ===== EDGE CASES: NEGATIONS =====
  {
    id: "edge-neg-001",
    conversation: `User: I don't like JavaScript. I avoid it whenever possible.
Assistant: What do you prefer for frontend work?
User: I use TypeScript exclusively. Never plain JavaScript.`,
    expectedFacts: [
      { subject: "user", predicate: "dislikes", object: "JavaScript", required: true },
      { subject: "user", predicate: "prefers", object: "TypeScript", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["JavaScript", "TypeScript", "avoid"],
    category: "preferences",
  },
  {
    id: "edge-neg-002",
    conversation: `User: We don't use Kubernetes. It's overkill for our scale.
Assistant: What do you use for deployment?
User: Just plain Docker Compose. Simple and works great for us.`,
    expectedFacts: [
      { subject: "team", predicate: "does_not_use", object: "Kubernetes", required: true },
      { subject: "team", predicate: "uses", object: "Docker Compose", required: true },
    ],
    expectedCausalLinks: [
      { cause: "Kubernetes is overkill", effect: "use Docker Compose instead", required: false },
    ],
    expectedKeywords: ["Kubernetes", "Docker Compose", "scale"],
    category: "technical",
  },

  // ===== EDGE CASES: CORRECTIONS =====
  {
    id: "edge-corr-001",
    conversation: `User: I work at Google. Actually, I meant to say I work at GitHub.
Assistant: GitHub, got it. What team are you on?
User: I'm on the Actions team.`,
    expectedFacts: [
      { subject: "user", predicate: "works_at", object: "GitHub", required: true },
      { subject: "user", predicate: "team", object: "Actions", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["GitHub", "Actions", "team"],
    category: "work",
  },
  {
    id: "edge-corr-002",
    conversation: `User: The server has 32GB of RAM. Wait, I just checked - it's actually 64GB.
Assistant: 64GB should give you plenty of headroom.
User: Yeah, we upgraded it last month. I forgot about that.`,
    expectedFacts: [{ subject: "server", predicate: "ram", object: "64GB", required: true }],
    expectedCausalLinks: [],
    expectedKeywords: ["server", "RAM", "64GB", "upgraded"],
    category: "technical",
  },

  // ===== EDGE CASES: AMBIGUOUS =====
  {
    id: "edge-amb-001",
    conversation: `User: Python is good for data science but terrible for production.
Assistant: It depends on the use case. Many companies use it in production.
User: Fair point. I guess I mean I prefer Go for backend services.`,
    expectedFacts: [
      {
        subject: "user",
        predicate: "thinks",
        object: "Python is good for data science",
        required: false,
      },
      { subject: "user", predicate: "prefers", object: "Go for backend services", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Python", "Go", "backend", "production"],
    category: "preferences",
  },

  // ===== EDGE CASES: NON-ENGLISH NAMES =====
  {
    id: "edge-intl-001",
    conversation: `User: My colleague Müller from our Berlin office is joining the call.
Assistant: Great, when is Müller joining?
User: In about 10 minutes. He's the lead architect there.`,
    expectedFacts: [
      { subject: "Müller", predicate: "location", object: "Berlin office", required: true },
      { subject: "Müller", predicate: "role", object: "lead architect", required: true },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["Müller", "Berlin", "architect"],
    category: "work",
  },
  {
    id: "edge-intl-002",
    conversation: `User: We're expanding to São Paulo and Tokyo next quarter.
Assistant: That's exciting! Will you have local engineering teams?
User: Yes, starting with 5 engineers in each location.`,
    expectedFacts: [
      { subject: "company", predicate: "expanding_to", object: "São Paulo", required: true },
      { subject: "company", predicate: "expanding_to", object: "Tokyo", required: true },
      { subject: "expansion", predicate: "timeline", object: "next quarter", required: false },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["São Paulo", "Tokyo", "expanding", "engineers"],
    category: "work",
  },

  // ===== EDGE CASES: TECHNICAL JARGON =====
  {
    id: "edge-jargon-001",
    conversation: `User: We use gRPC with protobuf for service-to-service communication.
Assistant: How's the performance compared to REST?
User: Much better. Latency dropped by 40% and payload sizes are smaller.`,
    expectedFacts: [
      { subject: "project", predicate: "uses", object: "gRPC", required: true },
      { subject: "project", predicate: "uses", object: "protobuf", required: true },
    ],
    expectedCausalLinks: [
      { cause: "switched to gRPC/protobuf", effect: "latency dropped by 40%", required: false },
    ],
    expectedKeywords: ["gRPC", "protobuf", "latency", "REST"],
    category: "technical",
  },
  {
    id: "edge-jargon-002",
    conversation: `User: Our ML pipeline uses XGBoost for the ranking model.
Assistant: What features does it use?
User: User behavior signals, item embeddings, and temporal features.`,
    expectedFacts: [
      { subject: "ML pipeline", predicate: "uses", object: "XGBoost", required: true },
      {
        subject: "ranking model",
        predicate: "features",
        object: "user behavior signals",
        required: false,
      },
      {
        subject: "ranking model",
        predicate: "features",
        object: "item embeddings",
        required: false,
      },
    ],
    expectedCausalLinks: [],
    expectedKeywords: ["ML", "XGBoost", "ranking", "embeddings"],
    category: "technical",
  },

  // ===== MULTI-TURN CONTEXT-DEPENDENT =====
  {
    id: "multi-001",
    conversation: `User: I'm debugging a performance issue.
Assistant: What kind of performance issue?
User: The API is slow. It takes 5 seconds to respond.
Assistant: Have you profiled it?
User: Yes, 80% of the time is spent in the database query.
Assistant: Is there an index on the queried columns?
User: No, there wasn't! I added one and now it's 200ms.`,
    expectedFacts: [
      { subject: "API", predicate: "original_response_time", object: "5 seconds", required: false },
      { subject: "API", predicate: "optimized_response_time", object: "200ms", required: false },
      { subject: "bottleneck", predicate: "was", object: "database query", required: true },
    ],
    expectedCausalLinks: [
      { cause: "missing index", effect: "80% of time spent in database query", required: true },
      { cause: "added index", effect: "API response time reduced to 200ms", required: true },
    ],
    expectedKeywords: ["performance", "API", "database", "index", "slow"],
    category: "technical",
  },
  {
    id: "multi-002",
    conversation: `User: We're evaluating new cloud providers.
Assistant: What are your requirements?
User: We need good Kubernetes support and competitive pricing.
Assistant: What's your current setup?
User: AWS with EKS. It's expensive and complex.
Assistant: Have you looked at GCP's GKE?
User: Yes, we're actually migrating to GKE next month. The pricing is 30% cheaper.`,
    expectedFacts: [
      { subject: "team", predicate: "current_cloud", object: "AWS", required: true },
      { subject: "team", predicate: "uses", object: "EKS", required: true },
      { subject: "team", predicate: "migrating_to", object: "GKE", required: true },
      { subject: "migration", predicate: "timeline", object: "next month", required: false },
    ],
    expectedCausalLinks: [
      { cause: "AWS is expensive and complex", effect: "migrating to GKE", required: false },
      { cause: "GKE pricing is 30% cheaper", effect: "chose GKE over EKS", required: true },
    ],
    expectedKeywords: ["AWS", "GCP", "GKE", "EKS", "migration", "pricing"],
    category: "multi_session",
  },
  {
    id: "multi-003",
    conversation: `User: Remember when we discussed the auth refactor last week?
Assistant: Yes, you were going to switch from JWT to sessions.
User: Right. I finished it yesterday. The session store is Redis now, like we decided.`,
    expectedFacts: [
      { subject: "user", predicate: "discussed", object: "auth refactor last week", required: true },
      { subject: "auth", predicate: "changed_from", object: "JWT to sessions", required: true },
      { subject: "session_store", predicate: "is", object: "Redis", required: true },
    ],
    expectedCausalLinks: [
      { cause: "previous discussion", effect: "implemented Redis session store", required: false },
    ],
    expectedKeywords: ["auth", "JWT", "sessions", "Redis"],
    category: "multi_session",
  },

  // ===== NEGATIVE TESTS (should extract 0 facts) =====
  {
    id: "neg-001",
    conversation: `User: Hey, how's it going?
Assistant: I'm doing well! How can I help you today?
User: Nothing specific, just saying hi.
Assistant: That's nice! Feel free to reach out whenever you need anything.
User: Thanks, will do. Have a good day!`,
    expectedFacts: [],
    expectedCausalLinks: [],
    expectedKeywords: [],
    category: "user_info",
  },
  {
    id: "neg-002",
    conversation: `User: Nice weather today, isn't it?
Assistant: It depends on where you are! What's it like where you are?
User: Pretty sunny. Anyway, I was just making conversation.
Assistant: No problem! Let me know if you need help with anything.
User: Sure thing, bye!`,
    expectedFacts: [],
    expectedCausalLinks: [],
    expectedKeywords: [],
    category: "user_info",
  },
  {
    id: "neg-003",
    conversation: `User: Can you help me with something?
Assistant: Of course! What do you need?
User: Actually, never mind. I figured it out.
Assistant: Great! Glad you got it sorted.
User: Yeah, it was simpler than I thought. Thanks anyway.`,
    expectedFacts: [],
    expectedCausalLinks: [],
    expectedKeywords: [],
    category: "user_info",
  },

  // ===== CAUSAL REASONING (rich, 2-3 links each) =====
  {
    id: "causal-rich-001",
    conversation: `User: I switched to TypeScript because JavaScript had too many runtime bugs.
Assistant: That's a common reason. How's it been?
User: Much better. The compiler catches most errors before they hit production, which saved us a week of debugging last month.`,
    expectedFacts: [
      { subject: "user", predicate: "uses", object: "TypeScript", required: true },
    ],
    expectedCausalLinks: [
      { cause: "JavaScript runtime bugs", effect: "switched to TypeScript", required: true },
      { cause: "TypeScript compiler catches errors", effect: "saved a week of debugging", required: true },
    ],
    expectedKeywords: ["TypeScript", "JavaScript", "bugs", "compiler"],
    category: "causal",
  },
  {
    id: "causal-rich-002",
    conversation: `User: The server crashed which caused us to lose the demo with the client.
Assistant: That's terrible. What happened?
User: A memory leak in the WebSocket handler. We didn't have proper connection cleanup, so connections piled up until the server ran out of memory.`,
    expectedFacts: [
      { subject: "server_crash", predicate: "cause", object: "memory leak in WebSocket handler", required: true },
    ],
    expectedCausalLinks: [
      { cause: "memory leak in WebSocket handler", effect: "server crashed", required: true },
      { cause: "server crash", effect: "lost the demo with client", required: true },
      { cause: "no connection cleanup", effect: "connections piled up and out of memory", required: false },
    ],
    expectedKeywords: ["server", "crash", "demo", "memory leak", "WebSocket"],
    category: "causal",
  },
  {
    id: "causal-rich-003",
    conversation: `User: After reading the distributed systems paper, I decided to change our architecture from monolith to microservices.
Assistant: That's a big decision. How did the team react?
User: They were skeptical at first, but after seeing the independent deployment benefits, they got on board quickly.`,
    expectedFacts: [
      { subject: "team", predicate: "architecture", object: "microservices", required: true },
    ],
    expectedCausalLinks: [
      { cause: "reading distributed systems paper", effect: "decided to change to microservices", required: true },
      { cause: "independent deployment benefits", effect: "team accepted microservices", required: true },
    ],
    expectedKeywords: ["architecture", "microservices", "monolith", "paper"],
    category: "causal",
  },
  {
    id: "causal-rich-004",
    conversation: `User: We adopted Kubernetes because our Docker Compose setup couldn't handle the scaling requirements.
Assistant: Makes sense for scaling. Any challenges?
User: The learning curve was steep, which slowed our velocity for about 2 months. But now deployments are 5x faster.`,
    expectedFacts: [
      { subject: "team", predicate: "uses", object: "Kubernetes", required: true },
    ],
    expectedCausalLinks: [
      { cause: "Docker Compose couldn't handle scaling", effect: "adopted Kubernetes", required: true },
      { cause: "Kubernetes learning curve", effect: "slowed velocity for 2 months", required: true },
    ],
    expectedKeywords: ["Kubernetes", "Docker Compose", "scaling", "learning curve"],
    category: "causal",
  },
  {
    id: "causal-rich-005",
    conversation: `User: The database kept timing out because we had N+1 queries everywhere.
Assistant: Classic ORM problem. How did you fix it?
User: We added eager loading and batched queries. Response times dropped from 8 seconds to 200ms, so users stopped complaining.`,
    expectedFacts: [],
    expectedCausalLinks: [
      { cause: "N+1 queries", effect: "database kept timing out", required: true },
      { cause: "added eager loading and batched queries", effect: "response times dropped from 8s to 200ms", required: true },
      { cause: "faster response times", effect: "users stopped complaining", required: false },
    ],
    expectedKeywords: ["database", "N+1", "eager loading", "timeout"],
    category: "causal",
  },
  {
    id: "causal-rich-006",
    conversation: `User: I quit my last job because the burnout was unbearable. 80-hour weeks with no recognition.
Assistant: That sounds really tough. How are things now?
User: Much better. The new company has a 4-day work week, which has completely changed my mental health.`,
    expectedFacts: [
      { subject: "user", predicate: "left_previous_job", object: "due to burnout", required: true },
      { subject: "user", predicate: "current_company", object: "has 4-day work week", required: false },
    ],
    expectedCausalLinks: [
      { cause: "80-hour weeks with no recognition", effect: "burnout and quit job", required: true },
      { cause: "4-day work week", effect: "improved mental health", required: true },
    ],
    expectedKeywords: ["burnout", "quit", "4-day", "mental health"],
    category: "causal",
  },
  {
    id: "causal-rich-007",
    conversation: `User: We moved from MySQL to PostgreSQL because we needed better JSON support for our API.
Assistant: PostgreSQL's JSONB is excellent. Any migration issues?
User: The migration took 3 weeks, which delayed our Q1 release. But the query performance on JSON data improved by 10x.`,
    expectedFacts: [
      { subject: "team", predicate: "uses", object: "PostgreSQL", required: true },
      { subject: "team", predicate: "previous_database", object: "MySQL", required: false },
    ],
    expectedCausalLinks: [
      { cause: "needed better JSON support", effect: "moved from MySQL to PostgreSQL", required: true },
      { cause: "migration took 3 weeks", effect: "delayed Q1 release", required: true },
    ],
    expectedKeywords: ["MySQL", "PostgreSQL", "JSON", "migration"],
    category: "causal",
  },
  {
    id: "causal-rich-008",
    conversation: `User: Our CI was failing randomly because of flaky tests. It destroyed developer trust in the pipeline.
Assistant: Flaky tests are a morale killer. What did you do?
User: We quarantined the flaky tests and added retry logic. Now the pipeline is green 98% of the time, so developers actually look at failures.`,
    expectedFacts: [],
    expectedCausalLinks: [
      { cause: "flaky tests", effect: "CI failing randomly", required: true },
      { cause: "CI failing randomly", effect: "destroyed developer trust in pipeline", required: true },
      { cause: "quarantined flaky tests and added retry", effect: "pipeline green 98% of time", required: true },
    ],
    expectedKeywords: ["CI", "flaky tests", "pipeline", "quarantine"],
    category: "causal",
  },
  {
    id: "causal-rich-009",
    conversation: `User: The startup ran out of funding because we couldn't close the Series A in time.
Assistant: That's really unfortunate. What happened to the team?
User: Most people found jobs quickly since our tech was solid. The CTO got hired by Google, which validated our architecture.`,
    expectedFacts: [
      { subject: "startup", predicate: "status", object: "ran out of funding", required: true },
    ],
    expectedCausalLinks: [
      { cause: "couldn't close Series A in time", effect: "startup ran out of funding", required: true },
      { cause: "solid tech and architecture", effect: "team found jobs quickly", required: true },
    ],
    expectedKeywords: ["startup", "funding", "Series A", "hired"],
    category: "causal",
  },
  {
    id: "causal-rich-010",
    conversation: `User: We switched from Slack to Discord because Slack's pricing got ridiculous for our team size.
Assistant: Discord for work is getting more popular. How did the team adapt?
User: The transition was rough for a week since everyone had muscle memory for Slack. But the unlimited history sold everyone.`,
    expectedFacts: [
      { subject: "team", predicate: "uses", object: "Discord", required: true },
      { subject: "team", predicate: "previous_tool", object: "Slack", required: false },
    ],
    expectedCausalLinks: [
      { cause: "Slack pricing too high for team size", effect: "switched to Discord", required: true },
      { cause: "unlimited message history", effect: "team accepted Discord", required: true },
    ],
    expectedKeywords: ["Slack", "Discord", "pricing", "history"],
    category: "causal",
  },
];

// =============================================================================
// CATEGORIES
// =============================================================================

export const DATASET_CATEGORIES = [
  "user_info",
  "preferences",
  "work",
  "technical",
  "causal",
  "temporal",
  "emotional",
  "multi_session",
] as const;

export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get test cases by category
 */
export function getTestCasesByCategory(category: DatasetCategory): GoldenTestCase[] {
  return GOLDEN_DATASET.filter((tc) => tc.category === category);
}

/**
 * Get dataset statistics
 */
export function getDatasetStats(): {
  total: number;
  byCategory: Record<string, number>;
  totalExpectedFacts: number;
  totalExpectedCausalLinks: number;
  requiredFactsCount: number;
  requiredCausalLinksCount: number;
} {
  const byCategory: Record<string, number> = {};
  for (const cat of DATASET_CATEGORIES) {
    byCategory[cat] = getTestCasesByCategory(cat).length;
  }

  const totalExpectedFacts = GOLDEN_DATASET.reduce((sum, tc) => sum + tc.expectedFacts.length, 0);
  const totalExpectedCausalLinks = GOLDEN_DATASET.reduce(
    (sum, tc) => sum + tc.expectedCausalLinks.length,
    0,
  );
  const requiredFactsCount = GOLDEN_DATASET.reduce(
    (sum, tc) => sum + tc.expectedFacts.filter((f) => f.required).length,
    0,
  );
  const requiredCausalLinksCount = GOLDEN_DATASET.reduce(
    (sum, tc) => sum + tc.expectedCausalLinks.filter((c) => c.required).length,
    0,
  );

  return {
    total: GOLDEN_DATASET.length,
    byCategory,
    totalExpectedFacts,
    totalExpectedCausalLinks,
    requiredFactsCount,
    requiredCausalLinksCount,
  };
}

/**
 * Get a random sample of test cases
 */
export function getSampleTestCases(count: number): GoldenTestCase[] {
  const shuffled = [...GOLDEN_DATASET].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
