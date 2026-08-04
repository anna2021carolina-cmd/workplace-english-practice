import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bank = JSON.parse(await readFile(new URL("../data/question-bank.json", import.meta.url), "utf8"));
const app = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.equal(bank.schemaVersion, 1, "Question bank schema version must be 1");
assert.equal(bank.bank.version, "1.0.1", "Question bank version must include the review fixes");
assert.equal(bank.items.length, 14, "The first bank must contain 14 scenarios");
assert.equal(bank.items.filter((item) => item.mode === "email").length, 6, "Expected 6 email scenarios");
assert.equal(bank.items.filter((item) => item.mode === "phone").length, 8, "Expected 8 phone scenarios");
assert.equal(new Set(bank.items.map((item) => item.id)).size, bank.items.length, "Question IDs must be unique");

for (const item of bank.items) {
  assert.match(item.id, /^(email|phone)-[a-z0-9-]+$/, `Invalid item ID: ${item.id}`);
  assert.ok(item.title && item.scenarioZh && item.category, `${item.id} needs scenario metadata`);
  assert.ok(Array.isArray(item.steps) && item.steps.length > 0, `${item.id} needs guided steps`);
  assert.ok(item.production?.target, `${item.id} needs a production target`);
  assert.ok(item.production?.accepted?.includes(item.production.target), `${item.id} must accept its target answer`);

  for (const step of item.steps) {
    assert.ok(["choice", "order", "fill"].includes(step.type), `${item.id} has an unsupported step type`);
    if (step.type === "choice") {
      assert.equal(step.options.filter((option) => option.correct).length, 1, `${item.id} choices need one correct answer`);
      for (const option of step.options.filter((option) => !option.correct)) {
        assert.ok(option.errorType && option.feedback, `${item.id} wrong choices need classified feedback`);
      }
    }
  }
}

const acceptableOptions = bank.items.flatMap((item) =>
  item.steps.flatMap((step) =>
    step.type === "choice" ? step.options.filter((option) => option.quality === "acceptable") : [],
  ),
);
assert.equal(acceptableOptions.length, 4, "Expected four valid-but-not-best choices");
assert.ok(
  acceptableOptions.every((option) => option.correct === false && option.errorType === "suboptimal"),
  "Acceptable choices must remain non-best and use the suboptimal classification",
);

const findItem = (id) => bank.items.find((item) => item.id === id);
const findFill = (id) => findItem(id).steps.find((step) => step.type === "fill");

assert.equal(findFill("phone-transfer-call-01").errorType, "usage", "Transfer fill tests usage, not spelling");
assert.equal(findFill("phone-confirm-number-01").errorType, "usage", "Confirm fill tests usage, not spelling");
assert.doesNotMatch(JSON.stringify(bank), /中間有兩個 r/, "Question bank must not teach an incorrect transfer spelling rule");

const confirmTime = findItem("email-confirm-time-01").steps[0].options.find((option) =>
  option.text.startsWith("Please confirm Tuesday"),
);
assert.match(confirmTime.feedback, /缺少 at/, "Time feedback must identify the missing preposition");

const missingDocument = findItem("email-request-missing-01").steps[0].options.find((option) =>
  option.text.startsWith("Please supply me"),
);
assert.match(missingDocument.feedback, /supply someone with something/, "Supply feedback must explain the verb pattern");

const repeatMistake = findItem("phone-ask-repeat-01").production.commonMistakes[0];
assert.equal(repeatMistake.errorType, "grammar", "Missing object after say is a grammar issue");
assert.match(repeatMistake.feedback, /缺少受詞/, "Repeat feedback must identify the missing object");

assert.ok(
  findItem("phone-ask-identity-01").production.accepted.includes("May I have your name and company, please?"),
  "The concise identity phrase should be accepted",
);

const serialized = JSON.stringify(bank);
assert.doesNotMatch(serialized, /@[a-z0-9.-]+\.[a-z]{2,}/i, "Question bank must not contain email addresses");
assert.doesNotMatch(serialized, /\b(?:\+?\d[\s-]*){8,}\b/, "Question bank must not contain real-looking phone numbers");
assert.match(html, /meta name="robots" content="noindex, nofollow"/, "Public page should discourage indexing");
assert.match(app, /fetch\("\.\/data\/question-bank\.json"/, "App should load the replaceable JSON bank locally");
assert.match(app, /option\.quality === "acceptable"/, "App must distinguish acceptable choices");
assert.match(app, /acceptable: 0/, "Round state must track acceptable choices separately");
assert.doesNotMatch(app, /https?:\/\//, "App code must not call external URLs");

console.log("Validated 14 generic scenarios, local-only application code, and question-bank structure.");
