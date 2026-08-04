import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bank = JSON.parse(await readFile(new URL("../data/question-bank.json", import.meta.url), "utf8"));
const app = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.equal(bank.schemaVersion, 1, "Question bank schema version must be 1");
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

const serialized = JSON.stringify(bank);
assert.doesNotMatch(serialized, /@[a-z0-9.-]+\.[a-z]{2,}/i, "Question bank must not contain email addresses");
assert.doesNotMatch(serialized, /\b(?:\+?\d[\s-]*){8,}\b/, "Question bank must not contain real-looking phone numbers");
assert.match(html, /meta name="robots" content="noindex, nofollow"/, "Public page should discourage indexing");
assert.match(app, /fetch\("\.\/data\/question-bank\.json"/, "App should load the replaceable JSON bank locally");
assert.doesNotMatch(app, /https?:\/\//, "App code must not call external URLs");

console.log("Validated 14 generic scenarios, local-only application code, and question-bank structure.");
