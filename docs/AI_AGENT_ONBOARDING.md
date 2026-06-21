# AI Agent Onboarding Guide — ManoSpeak

Welcome! This guide outlines the sequence of steps an AI agent or a new developer must take when first checking out the ManoSpeak repository.

## 1. Initial Setup Checklist
Follow these steps in order to set up your local development workspace:

### Step 1: Clone and Explore
Ensure you have cloned the repository correctly:
```bash
git clone <repo_url> TraductorSenas
cd TraductorSenas
```

### Step 2: Set up the Python ML Environment
Ensure you have Python 3.10+ and Poetry installed.
```bash
cd ml
poetry install
poetry run pytest  # Verify baseline test suite runs
```

### Step 3: Set up the React Native Mobile Environment
Ensure you have Node.js 18+ installed.
```bash
cd ../mobile
npm install
npm test           # Verify Jest test suite runs
```

## 2. Commit Rules
- All commits must conform to conventional commit rules specified in the root [AGENTS.md](file:///Users/jflorezgaleano/Documents/JulianFlorez/TraductorSeñas/AGENTS.md).
- Prioritize making discrete, test-checked changes rather than monolithic updates.
