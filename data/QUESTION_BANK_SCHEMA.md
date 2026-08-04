# Question bank contract

The interface reads `question-bank.json` at runtime. The file is intentionally separate from the HTML and application logic so the learning content can be replaced without rebuilding the interface.

## Required top-level fields

- `schemaVersion`: currently `1`
- `bank.id`: stable identifier for the collection
- `bank.version`: content version
- `items`: array of practice scenarios

## Required scenario fields

- `id`: stable and unique; existing IDs preserve local progress across revisions
- `mode`: `email` or `phone`
- `category`, `title`, `scenarioZh`
- `facts`: optional list of information the learner must communicate
- `steps`: one or more guided exercises
- `production`: final one-sentence recall exercise

Supported guided step types are `choice`, `order`, and `fill`. Every non-best choice must include an `errorType` and a short `feedback` explanation.

Choice outcomes use three levels:

- `correct: true`: the best answer for the stated situation
- `correct: false` with `quality: "acceptable"`: valid English that is less natural, less complete, or less aligned with the stated intent; it gives feedback but is not saved as a mistake
- `correct: false` without `quality: "acceptable"`: a genuine grammar, word-order, usage, or tone problem; it is saved for mistake review

Supported error types are:

- `spelling`
- `grammar`
- `word-order`
- `unnatural`
- `tone`
- `usage`
- `suboptimal`
- `needs-review`

The `production.accepted` array contains normalized answers that the static interface can safely accept. Known mistakes can be listed under `production.commonMistakes`. Any unmatched free-text answer is marked `needs-review` instead of being given an unreliable automatic diagnosis.

Do not add real names, employer details, email addresses, phone numbers, client data, or industry-specific confidential information to a public question bank.
