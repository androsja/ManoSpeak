# ManoSpeak — Root Agent Guide

Welcome to the **ManoSpeak** repository. This file serves as the main entry point and guide for AI agents and developers working on this codebase.

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
TraductorSeñas/ (ManoSpeak root)
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

## 4. Quick Commands

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
