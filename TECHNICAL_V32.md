# V32 learning engine — implementation and evaluation boundaries

## Separation of responsibilities

- `adaptive/`: own authored code for skill evidence, learning-session transitions, heuristics, contextual policy, and experimental neural Q-learning.
- `ai/provider.js`: default local Ollama transport, JSON-schema output, no automatic paid fallback. The previous OpenAI adapter remains optional only when explicitly selected by server configuration.
- `local-llm/Modelfile`: prompt/context customization of Qwen3, not a fine-tuned/pretrained foundation model authored here.
- Existing official assessment, submission and grading routes are not used to write AI scores. Skill links read completed MCQ evidence; external anonymous aggregate sheets do not silently become identified learner evidence.

## Skill estimate

For each enabled skill, use the latest reviewed answer per linked official question and latest completed practice answer per bank question. Beta(1,1) prior, alpha=1+correct, beta=1+incorrect. Display posterior mean only as an estimate; with no evidence show unmeasured. The approximate displayed interval is mean ±1.64 standard deviations, clipped to [0,1]; it is not calibrated through a knowledge-tracing validation study. The evidence model does not yet account for item discrimination, forgetting, prerequisite graphs or correlated questions.

## Intervention session and provenance

Exactly two diagnostic items and two different post items. Pairing enforces equal author-assigned difficulty for each pre/post pair. Item payloads are snapshotted server-side so editing a bank item does not change an in-flight answer key. Resource text is snapshotted when chosen. No keys are returned before completion. Sessions reserve items; only sessions using four previously unused/unreserved items for that learner/skill are training eligible. Completed repeats still support practice but are not new policy samples. Latest-answer deduplication avoids inflating skill evidence through repetition.

Reward = post accuracy − pre accuracy in [-1,1]. This noisy two-item difference is an observed outcome, not proof of treatment effect or retention. Guessing, practice effects, intentional low diagnostic scores and uncontrolled difficulty can confound it. Never use this reward to allocate official grades, sanctions or admissions. Add larger parallel test forms and delayed retention measurements before making efficacy claims.

## Contextual policy

Features: intercept, posterior mean after the current diagnostic, min(evidence/20,1), min(4×posterior sd,1), min(completed sessions/8,1), clipped last gain. No names, IDs, emails, protected traits or private chat features are input to the model.

One ridge regression (lambda=1) per intervention type estimates reward from context. In heuristic mode choices are deterministic among approved available types. In pilot/bandit mode epsilon=0.15 and probabilities are recorded exactly: epsilon/k + (1-epsilon) for the greedy action, epsilon/k otherwise. Before readiness the greedy action is the heuristic; afterwards it is the largest predicted outcome. Readiness: ≥30 eligible samples, ≥5 learners, ≥3 outcomes for every currently available type. These are conservative operating defaults, not statistical significance criteria. Models are refit deterministically from genuine persisted eligible session outcomes; no simulated rewards are inserted in production.

Every decision logs method, context, available action mask, baseline action, probabilities, resource snapshot and actual outcome. Content can vary within action type, so comparisons remain observational. There is no claim of optimal policy or proven learning uplift.

## Experimental Double-DQN

Pure JavaScript MLP 6→16→12→4, tanh hidden activations and linear outputs. Seeded initialization, replay sampling, Huber-clipped SGD gradients, target network refresh every100 steps, online argmax + target evaluation (Double-DQN), gamma0.8, bounded targets. 2500 training steps with12 replay updates/step. Worker memory/time caps isolate CPU work from web traffic. At most the latest3000 eligible transitions are used per experiment.

Transitions: state after diagnostic → chosen educational intervention → post-test reward → measured skill state after completion. Available next actions are recorded. A transition is terminal when the enabled skill reaches the configured implementation threshold (mean≥0.8 with ≥6 distinct evidence items), the skill is disabled or there are no next resources. This is a modeling assumption to validate, not an established learner MDP or a validated curriculum optimizer.

Train gate: ≥120 transitions, ≥10 learners; train≥60 rows, validation≥20 rows, training≥5 outcomes per action. Learners are deterministically split, minimum3 held-out learners. No learner appears in both sets. Store seed/feature version/architecture/reward definition, dataset hash, weights and diagnostics.

TD error measures Bellman consistency of this model, not educational effectiveness. Self-normalized IPS estimates are shown only on held-out logs with probability support for all available actions. Report match count and effective sample size. There are no confidence intervals or automatic promotion decisions. Unsupported/low-overlap candidate actions do not acquire invented outcomes. The network is strictly shadow/offline; live decisions use heuristics/contextual bandit only.

## Operational boundaries

- Production continues using the existing single-process, Google Sheets-backed design. Adaptive tables use the same debounced persistence. Concurrent replicas require centralized atomic session/rate/policy storage before scaling.
- Full snapshot persistence is retained; batching header reads reduces quota pressure but does not make Google Sheets an unlimited event store. Monitor growth, back up data and plan a transactional data store if traffic increases. Do not manually fabricate session rows or policy evidence in Sheets.
- Ollama localhost is a separate service. Render localhost cannot reach a user's desktop. The provided gateway exposes only authenticated /api/chat and /api/tags over HTTPS, not model installation/admin endpoints. Localhost11434 remains bound locally in the Docker template.
- Model weights are downloaded from the model publisher through Ollama on the user's infrastructure. They are not embedded in this archive. The Qwen3 base is Apache2.0 as documented on its official model page; comply with model/dependency license requirements when redistributing weights or derived models. Keep the base model license and attribution when exporting models.
- Model availability/format and recommendation quality require evaluation on the actual deployment and curriculum. No real learner efficacy study or on-device latency benchmark is claimed.

## Primary references

- Ollama chat API: https://docs.ollama.com/api/chat
- Ollama structured output: https://ollama.com/blog/structured-outputs
- Qwen3 4B model/quantization/license: https://ollama.com/library/qwen3:4b
- Base model card/license: https://huggingface.co/Qwen/Qwen3-4B
- Contextual bandit context/action/propensity/reward: https://vowpalwabbit.org/tutorials/contextual_bandits.html
- Offline policy evaluation and overlap limitations: https://vowpalwabbit.org/docs/vowpal_wabbit/python/latest/tutorials/off_policy_evaluation.html
- DQN replay and target-network foundation: https://deepmind-media.storage.googleapis.com/dqn/DQNNaturePaper.pdf
- Double-DQN: https://arxiv.org/abs/1509.06461
