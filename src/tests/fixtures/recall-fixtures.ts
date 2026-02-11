/**
 * Recall test fixtures: questions and expected answers.
 * Used by proof:recall to test question → answer from memory.
 *
 * SHA-256 (verification): shasum -a 256 src/tests/fixtures/recall-fixtures.ts
 */

export type RecallQuestion = {
  id: string;
  testCaseId: string;
  question: string;
  expectedAnswer: string;
  type: "factual" | "temporal" | "causal" | "preference";
};

export const RECALL_QUESTIONS: RecallQuestion[] = [
  // user-001
  { id: "rq-001", testCaseId: "user-001", question: "What is the user's name?", expectedAnswer: "Alex Chen", type: "factual" },
  { id: "rq-002", testCaseId: "user-001", question: "Where does the user work?", expectedAnswer: "TechCorp", type: "factual" },
  { id: "rq-003", testCaseId: "user-001", question: "What kind of engineering does the user do?", expectedAnswer: "backend", type: "factual" },
  { id: "rq-004", testCaseId: "user-001", question: "How long has the user been at their job?", expectedAnswer: "3 years", type: "factual" },
  // user-002
  { id: "rq-005", testCaseId: "user-002", question: "Where does the user live?", expectedAnswer: "San Francisco", type: "factual" },
  { id: "rq-006", testCaseId: "user-002", question: "Where is the user originally from?", expectedAnswer: "Seattle", type: "factual" },
  { id: "rq-007", testCaseId: "user-002", question: "Why did the user move to San Francisco?", expectedAnswer: "job", type: "causal" },
  { id: "rq-008", testCaseId: "user-002", question: "How long has the user been in SF?", expectedAnswer: "5 years", type: "factual" },
  // user-003
  { id: "rq-009", testCaseId: "user-003", question: "What are the names of the user's children?", expectedAnswer: "Emma and Jake", type: "factual" },
  { id: "rq-010", testCaseId: "user-003", question: "How old is Emma?", expectedAnswer: "7", type: "factual" },
  { id: "rq-011", testCaseId: "user-003", question: "How old is Jake?", expectedAnswer: "4", type: "factual" },
  { id: "rq-012", testCaseId: "user-003", question: "What grade is Emma in?", expectedAnswer: "second grade", type: "factual" },
  // user-004
  { id: "rq-013", testCaseId: "user-004", question: "What is the user's personal email?", expectedAnswer: "sarah.j.miller@company.com", type: "factual" },
  { id: "rq-014", testCaseId: "user-004", question: "What is the user's phone number?", expectedAnswer: "555-123-4567", type: "factual" },
  { id: "rq-015", testCaseId: "user-004", question: "What is the user's work email?", expectedAnswer: "sarah.miller@workcompany.io", type: "factual" },
  { id: "rq-016", testCaseId: "user-004", question: "Which email should be used for professional stuff?", expectedAnswer: "sarah.miller@workcompany.io", type: "factual" },
  // user-005
  { id: "rq-017", testCaseId: "user-005", question: "How old is the user?", expectedAnswer: "34", type: "factual" },
  { id: "rq-018", testCaseId: "user-005", question: "When is the user's birthday?", expectedAnswer: "March 15", type: "factual" },
  { id: "rq-019", testCaseId: "user-005", question: "What is the user's zodiac sign?", expectedAnswer: "Pisces", type: "factual" },
  { id: "rq-020", testCaseId: "user-005", question: "How does the user typically celebrate their birthday?", expectedAnswer: "dinner with family", type: "factual" },
];
