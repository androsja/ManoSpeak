# Vozual — Root Agent Guide

Welcome to the **Vozual** repository. This file serves as the main entry point and guide for AI agents and developers working on this codebase.

## 1. Document Index

| Document | Description |
| :--- | :--- |
| [PRODUCT_SPEC.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/PRODUCT_SPEC.md) | Non-technical spec: Stoke queremas, LSC integration, and project goals. |
| [ARCHITECTURE.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/ARCHITECTURE.md) | Computational flow: MediaPipe extraction, Sliding Windows, PhonSSM, and TTS. |
| [STANDARDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/STANDARDS.md) | Invariances, coordinate normalizations, INT8 quantization, and Sim2Real augmentation. |
| [DEVELOPMENT_COMMANDS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DEVELOPMENT_COMMANDS.md) | Authoritative reference for running and building the ML and Mobile modules. |
| [TESTING_GUIDE.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/TESTING_GUIDE.md) | Testing protocols: mocking landmarks, mobile component test cases. |
| [SECURITY.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/SECURITY.md) | Local-first, on-device data isolation, and user privacy boundaries. |
| [PERFORMANCE.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/PERFORMANCE.md) | Mobile execution metrics (30+ FPS, <15MB model footprint, <100ms latency). |
| [DESIGN.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/DESIGN.md) | Vocal synthesis modulation (TTS) and UI translation presentation. |
| [AI_AGENT_ONBOARDING.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/docs/AI_AGENT_ONBOARDING.md) | Quickstart guide for setting up environments and making first commits. |
| [AI_AGENT_COLLAB.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/docs/docs/AI_AGENT_COLLAB.md) | Rules on concurrency, handoffs, and avoiding conflicts. |

## 2. Directory Structure

```text
TraductorSeñas/ (Vozual root)
├── ml/                       # Python ML training and coordinate extraction
│   ├── src/                  # Feature extractors, normalizers, and training loops
│   ├── tests/                # Unit tests for preprocessing and model serialization
│   ├── pyproject.toml        # Python poetry package configuration
│   └── README.md             # Module readme
├── mobile/                   # React Native app
│   ├── src/                  # App components, hook logic, and state management
│   ├── assets/               # Fonts, local models, and images
│   ├── package.json          # Node dependencies and scripts
│   └── README.md             # Module readme
├── docs/                     # Detailed architectural and standard guides
├── .agents/                  # Agent persona configurations and commands
└── .dwp/                     # Gitignored Deep Work Plan databases (plans/drafts)
```

## 3. Mandatory Development Rules

1. **Language:** English-only for code, comments, commit messages, and documentation (except where Spanish is explicitly needed to reference LSC Spanish glossaries/dictionaries).
2. **Conventional Commits:** Commit messages must follow the `type(scope): description` pattern:
   - **Scopes:** `ml`, `mobile`, `docs`, `config`, `dwp`
   - **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
3. **Validation Gates:** Before proposing a change as complete, you must run the validation commands for the relevant modules. Never commit code that breaks linting, type checks, or unit tests.
4. **Gitignored Areas:** Never commit to or track files inside `.dwp/` or `tmp/` folders. These are runtime/scratch workspaces.
5. **No Placeholders:** Never write `<your code here>` or `TODO: add tests`. Propose stub implementations or ask the user directly if requirements are unclear.

## 4. Motion Formats and Firebase Publication

- New and updated sign motions use authored JSON and are published through the immutable `signJsonReleases/{releaseId}` Firebase release plus its active pointer. Do not publish new work through the legacy per-sign compact/Base64 route.
- Existing legacy assets remain readable for compatibility. Preserve that reader, but do not treat legacy assets as the source format for new signs.
- A local JSON file, including a generated number-motion draft, is not available to users until it has passed the approved-sign workflow and is included in an explicitly published JSON release. A release must include the intended playable signs and their reviewed speech aliases.
- Voice playback is limited to signs in the user's installed library. When a recognized word does not animate, check the active Firebase JSON release manifest and the device's installed-sign list before diagnosing speech recognition.
- `motionFormat: "legacy-json-v2"` names the JSON document schema accepted by the runtime; it does not mean that the sign was fetched through the legacy Firebase publication route.

## 5. Quick Commands

### Mobile Module (`mobile/`)
| Purpose | Command | Notes |
| :--- | :--- | :--- |
| Install Dependencies | `npm install` | Run within `mobile/` |
| Start Metro Server | `npm start` | Or `npx expo start` if using Expo |
| Run Tests | `npm test` | Executed using Jest |
| Run Linter | `npm run lint` | ESLint checks |
| Run Typecheck | `npm run typecheck` | `tsc --noEmit` |

### Machine Learning Module (`ml/`)
| Purpose | Command | Notes |
| :--- | :--- | :--- |
| Install Dependencies | `poetry install` | Run within `ml/` |
| Run Training Tests | `poetry run pytest` | Unit testing models and extractors |
| Run Linter | `poetry run ruff check .` | Ruff fast lint checks |
| Run Typecheck | `poetry run mypy .` | Python strict typing |

## 6. Authoring and Publishing New LSC Signs

Follow this end-to-end workflow whenever creating, refining, or publishing a Colombian Sign Language (LSC) sign:

1. **Research the LSC Reference First:**
   - Look up the sign in the local references under `docs/references/lsc-manuals/` (`diccionario-basico-lsc-insor-mineducacion.pdf`, `diccionario-lsc-signwriting-2023.pdf`, `elementos-didactica-lsc-y-matematicas-estudiantes-sordos.pdf`) or in an owner-provided video/description.
   - Record the exact source citation and page number in the authoring recipe and documentation. Do not invent handshapes or claim linguistic approval without owner review.

2. **Create a Procedural Authoring Draft (`drafts/`):**
   - Add an editable keyframe recipe at `mobile/assets/motions/drafts/<category>/<slug>.authoring.json` and a deterministic generator script at `mobile/tools/generate-<slug>-motion-draft.cjs` (follow existing courtesy examples such as `mobile/tools/generate-gracias-motion-draft.cjs` and `mobile/tools/generate-querer-motion-draft.cjs`).
   - Generate `mobile/assets/motions/drafts/<category>/<slug>.motion.json` in `version: 2`, `layout: "pose33_left21_right21_face468"` format:
     - Keep uncaptured `face` landmarks as zeros unless explicitly captured, and drive facial expressions/handshapes via `avatarProfile` (`activeHand`, `forceTwoHands`, `rigArmDepthSpace: "shoulder-relative"`, `rigRightHandShape`, `rigLeftHandShape`, `rigHandKeyframes`, `contactAnchor`).
     - Set `publicationReview.status` to `"draft"`.
     - Add a unit test under `mobile/tools/__tests__/<slug>-authored-motion.test.ts` validating deterministic rebuilds, geometric/contact invariants, and `parseJsonMotionDocument`.

3. **Preview on the 3D Avatar and Get Owner Approval:**
   - Start the local 3D pose reference preview from `mobile/`:
     ```bash
     npm run pose:reference
     ```
   - Open `http://127.0.0.1:4175/hand-pose-reference?gloss=<URL_ENCODED_GLOSS>&draft=1` (or share the preview with the owner) and refine timing, coordinates, palm orientation, and finger curls until the owner explicitly approves the sign visually.
   - Never treat a draft as approved or publish it to Firebase without explicit owner approval.

4. **Promote the Approved Sign and Validate Locally:**
   - Write the approved motion to `mobile/assets/motions/<gloss_lowercase>.motion.json` with `publicationReview.status = "approved"`.
   - Update `mobile/assets/data/lsc_linguistic_catalog.json` (`review.status = "approved"`, `ownerApproval`, `synonyms`, `forms`), `mobile/assets/motions/published_signs.json`, `mobile/assets/motions/avatar_profile_overrides.json` (if runtime profile overrides are needed), and `mobile/assets/data/lsc_recommended_phrases.json` (when adding reviewed phrases).
   - Run the validation suite from `mobile/`:
     ```bash
     npm run build:published-signs && npm run audit:avatar-signs && npm run verify:release-assets && npm test -- --runInBand && npm run typecheck && npm run lint
     ```

5. **Publish an Immutable Firebase JSON Release (`signJsonReleases`):**
   - Always include the full set of live published glosses (not only the new sign) so existing signs stay available to users.
   - Dry-run first, then publish with `--publish` using `mobile/tools/publish-json-motion-release.cjs`:
     ```bash
     cd mobile
     node tools/publish-json-motion-release.cjs --release-id lsc-co-json-v<N> --version <N> --gloss HOLA --gloss GRACIAS ...
     node tools/publish-json-motion-release.cjs --publish --release-id lsc-co-json-v<N> --version <N> --gloss HOLA --gloss GRACIAS ...
     ```
   - Verify the live release and pointer with `npm run verify:published-signs` and `npm run status:published-signs`.
