# Session Reflection Patterns

How to extract lessons and reusable patterns from conversation sessions.

## Pattern Categories

### Pattern 1: Error -> Lesson

**Look for**:
- Lines containing "Error:", "Failed:", "Exception:", "not found"
- Tool calls that returned errors or non-zero exit codes
- User corrections after mistakes ("no, do it this way")
- Retried operations with different approaches

**Extract as**:
```
DON'T: [what caused the error]
BECAUSE: [error message or consequence]
DO INSTEAD: [what fixed it]
```

**Examples**:

Session excerpt:
```
> pip install package-name
ERROR: Could not find a version that satisfies the requirement
> uv pip install package-name
Successfully installed package-name
```

Extracted lesson:
```
DON'T: Use `pip install` directly in this codebase
BECAUSE: Dependency resolution fails with standard pip
DO INSTEAD: Use `uv pip install` for all package installations
```

---

### Pattern 2: Retry -> Best Practice

**Look for**:
- Same operation attempted multiple times
- Incremental improvements in approach
- Final successful attempt after one or more failures
- User saying "try again" or "that didn't work"

**Extract as**:
```
BEST PRACTICE: [final working approach]
AVOID: [approaches that didn't work]
CONTEXT: [when this applies]
```

**Examples**:

Session excerpt:
```
> curl https://api.example.com/data
curl: (28) Connection timed out
> curl --connect-timeout 5 https://api.example.com/data
curl: (28) Connection timed out
> curl --connect-timeout 5 --retry 3 --retry-delay 2 https://api.example.com/data
{"data": [...]}
```

Extracted lesson:
```
BEST PRACTICE: Use `--retry 3 --retry-delay 2` with curl for this API
AVOID: Single requests without retry logic
CONTEXT: The API has intermittent connectivity issues
```

---

### Pattern 3: Successful Workflow -> Reusable Pattern

**Look for**:
- Sequences of successful tool calls
- User positive feedback ("that worked", "perfect", "great")
- Complex multi-step operations completed without issues
- Operations that might need to be repeated

**Extract as**:
```
WORKFLOW: [descriptive name]
STEPS:
1. [first action]
2. [second action]
...
USE WHEN: [trigger conditions]
NOTES: [any caveats or variations]
```

**Examples**:

Session excerpt:
```
User: Deploy the new version
> git pull origin main
> docker compose build
> docker compose up -d
> docker compose logs -f app
User: Perfect, it's running
```

Extracted workflow:
```
WORKFLOW: Standard Deployment
STEPS:
1. Pull latest changes: `git pull origin main`
2. Rebuild containers: `docker compose build`
3. Start services: `docker compose up -d`
4. Verify: `docker compose logs -f app`
USE WHEN: Deploying new version to environment
NOTES: Check logs for startup errors before confirming success
```

---

### Pattern 4: Edge Case -> Warning

**Look for**:
- Unexpected behaviors that required special handling
- Platform-specific considerations (macOS vs Linux vs Windows)
- Conditions that only sometimes occur
- "Watch out for..." or "Be careful with..." mentions

**Extract as**:
```
WATCH OUT: [the edge case description]
WHEN: [conditions that trigger it]
SYMPTOMS: [how to recognize it]
HANDLE BY: [solution or workaround]
```

**Examples**:

Session excerpt:
```
> python script.py
FileNotFoundError: config.json
User: Oh, it needs to run from the project root
> cd /project && python script.py
Success
```

Extracted warning:
```
WATCH OUT: Script requires specific working directory
WHEN: Running Python scripts in this project
SYMPTOMS: FileNotFoundError for config files
HANDLE BY: Always run from project root, or use absolute paths
```

---

## Lesson Categories for Plugins

When creating a plugin from extracted lessons, organize into these categories:

### 1. Configuration Lessons

Information about setup and environment:
- Required environment variables
- Config file locations and formats
- Dependency requirements
- Path conventions

**Goes in**: SKILL.md body or dedicated `references/configuration.md`

### 2. Workflow Lessons

Step sequences that accomplish tasks:
- Order of operations that works
- Dependencies between steps
- Validation checks at each step
- Rollback procedures

**Goes in**: Command workflow phases or `references/workflows.md`

### 3. Error Handling Lessons

How to deal with failures:
- Common error messages and causes
- Recovery strategies
- Validation checks to prevent errors
- Diagnostic commands

**Goes in**: SKILL.md body "Error Handling" section or command "Troubleshooting" section

### 4. Integration Lessons

How things connect:
- Tool combinations that work well
- API patterns and authentication
- Data flow between components
- External service quirks

**Goes in**: Reference documents or skill body sections

---

## Output Formats

For each extracted lesson, choose the appropriate output:

### 1. Instruction in SKILL.md Body

For workflow guidance that applies broadly:

```markdown
## Database Operations

Always use the migration tool before modifying schema:
```bash
python manage.py migrate --check
```
```

### 2. Rule in SKILL.md Description

For trigger conditions and key constraints:

```yaml
description: |
  Handles database migrations safely. Use when modifying models,
  adding tables, or changing schema. NEVER modify schema directly -
  always use migrations.
```

### 3. Script Logic

For automated checks that should run programmatically:

```python
def validate_environment():
    """Check required environment before proceeding."""
    required = ['DATABASE_URL', 'API_KEY']
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise EnvironmentError(f"Missing required vars: {missing}")
```

### 4. Reference Document

For detailed procedures that would bloat the main skill:

```markdown
# Database Migration Procedures

## Adding a New Table
1. Create model in models.py
2. Generate migration: `python manage.py makemigrations`
3. Review migration file
4. Apply: `python manage.py migrate`
5. Verify: `python manage.py showmigrations`

## Rolling Back
...
```

---

## Session Analysis Checklist

When reflecting on a session, systematically check:

- [ ] Any error messages? -> Extract as DON'T/BECAUSE/DO INSTEAD
- [ ] Any retried operations? -> Extract as BEST PRACTICE
- [ ] Any multi-step sequences? -> Extract as WORKFLOW
- [ ] Any special conditions mentioned? -> Extract as WATCH OUT
- [ ] Any tool combinations used? -> Note for integration lessons
- [ ] Any user corrections? -> Extract the corrected approach
- [ ] Any "finally worked" moments? -> Capture what made it work

---

## Quality Criteria for Extracted Lessons

Good lessons are:
- **Specific**: Include actual commands, paths, or values
- **Actionable**: Clear what to do or not do
- **Contextual**: When does this apply?
- **Testable**: Can verify if following the lesson

Bad lessons are:
- **Vague**: "Be careful with the API" (what specifically?)
- **Obvious**: "Check for errors" (everyone knows this)
- **Incomplete**: Missing the solution or workaround
- **Over-broad**: Applies to everything, helps with nothing
