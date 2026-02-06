---
allowed-tools: Bash(python:*), Read, AskUserQuestion
argument-hint: [year] [month] | [expense-ids...]
description: Mark expenses as paid - interactive selection or by IDs
---

# Pay Bills

Mark expenses as paid, either interactively or by providing expense IDs.

**Requires**: CWD is the controle-financeiro project root.

## Workflow

### If expense IDs provided in arguments:
1. Run `mark-paid <id1> <id2> ...` directly
2. Show confirmation of what was marked

### If no IDs provided (interactive mode):
1. **Determine Month**:
   - If year/month in arguments, use those
   - Otherwise, get latest month from `list-months --limit 1`

2. **List Pending Expenses**: Run `list-expenses <year> <month>` and filter to show only PENDING items

3. **Ask User**: Present the pending list and ask which to mark as paid:
   - "Quais contas foram pagas?"
   - Show options: All, specific IDs, or none

4. **Mark as Paid**: Run `mark-paid <selected-ids>`

5. **Show Updated Status**: Run `list-expenses <year> <month>` to confirm changes

## CLI Commands Reference

```bash
# List expenses with IDs and status
python app/src/cli.py list-expenses 2026 2

# Mark multiple as paid
python app/src/cli.py mark-paid 123 124 125

# Toggle single expense
python app/src/cli.py toggle-paid 123
```

## Examples

```
/controle-financeiro:pay-bills
→ Shows pending for latest month, asks which to mark paid

/controle-financeiro:pay-bills 2026 2
→ Shows pending for February 2026, asks which to mark paid

/controle-financeiro:pay-bills 123 124 125
→ Directly marks expenses 123, 124, 125 as paid
```

## Interactive Flow

1. Show list of PENDING expenses:
   ```
   Pending expenses for Fevereiro 2026:
     ID     Description               Amount
     123    Aluguel                   R$ 2.500,00
     124    Condominio                R$ 850,00
     125    Luz                       R$ 280,00
   ```

2. Ask: "Which expenses have been paid?"
   - Option: "All" - mark all pending
   - Option: "Specific IDs" - user enters: 123 125
   - Option: "None" - cancel

3. Execute and confirm

## Important

- Only show PENDING expenses in the selection
- After marking, show the updated status
