# Syncs the "Good First Issues" GitHub Project (v2) board status from pull
# request lifecycle events:
#
#   PR opened / reopened / ready_for_review  → linked issues → Status: In Progress
#   PR merged                                → linked issues → Status: Done
#
# The script reads the GitHub event payload from $GITHUB_EVENT_PATH, extracts
# issue references from the PR body ("Closes #N", "Fixes #N", "Resolves #N",
# "close #N", ...), and updates the matching board items via the GraphQL API.
#
# Design notes:
# - Runs under `pull_request_target`, so the workflow executes the version of
#   this script from the DEFAULT branch (never the fork's code). The PR body
#   is treated as plain data (regex extraction only, no eval) — safe.
# - Only reacts to issues that are already on the board; unknown issues are
#   skipped with a log line (keeps the board curated).
# - Idempotent: no-op when the item is already in the target status.
# - Requires GH_TOKEN (PAT) with `project` scope — the default GITHUB_TOKEN
#   cannot access Projects v2.

import json
import os
import re
import subprocess
import sys
from typing import Optional

# --- config -----------------------------------------------------------------

PROJECT_ID = "PVT_kwHOB6rkFc4Bfd-4"          # "Good First Issues" board
STATUS_FIELD_NAME = "Status"
STATUS_TODO = "Todo"
STATUS_IN_PROGRESS = "In Progress"
STATUS_DONE = "Done"

# Statuses mapped from PR events. (action, merged) → board status
ACTION_OPEN = {"opened", "reopened", "ready_for_review", "converted_to_ready_for_review"}

# --- helpers ----------------------------------------------------------------

def gh_graphql(query: str, **variables) -> dict:
    """Run a GraphQL mutation/query via the gh CLI (uses GH_TOKEN)."""
    args = ["gh", "api", "graphql", "-f", f"query={query}"]
    for name, value in variables.items():
        args += ["-F", f"{name}={value}"]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"gh api graphql failed: {proc.stderr.strip()}")
    return json.loads(proc.stdout)


def get_status_field() -> dict:
    """Resolve the Status field and its options for the board (dynamic, so the
    script survives board recreation)."""
    query = """
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options { id name }
              }
            }
          }
        }
      }
    }
    """
    data = gh_graphql(query, projectId=PROJECT_ID)
    for field in data["data"]["node"]["fields"]["nodes"]:
        if field.get("name") == STATUS_FIELD_NAME:
            options = {opt["name"]: opt["id"] for opt in field["options"]}
            return {"id": field["id"], **options}
    raise RuntimeError(f"Status field not found on board {PROJECT_ID}")


def board_items() -> dict:
    """Map issue number → board item id, by walking the board's items."""
    query = """
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes {
              id
              content {
                ... on Issue { number }
                ... on PullRequest { number }
              }
            }
          }
        }
      }
    }
    """
    data = gh_graphql(query, projectId=PROJECT_ID)
    result = {}
    for item in data["data"]["node"]["items"]["nodes"]:
        content = item.get("content") or {}
        if "number" in content:
            result[content["number"]] = item["id"]
    return result


def issue_node_id(owner_repo: str, number: int) -> Optional[str]:
    """Resolve the node id of an issue (None if it doesn't exist)."""
    proc = subprocess.run(
        ["gh", "api", f"repos/{owner_repo}/issues/{number}", "--jq", ".id"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


def set_item_status(field: dict, item_id: str, status_name: str) -> None:
    """Set the Status field of a board item (no-op if already set)."""
    query = """
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) { projectV2Item { id } }
    }
    """
    gh_graphql(query, projectId=PROJECT_ID, itemId=item_id, fieldId=field["id"], optionId=field[status_name])


def extract_linked_issues(body: str) -> list[int]:
    """Extract issue numbers from keywords in a PR body: Closes/Fixes/Resolves."""
    pattern = re.compile(
        r"\b(?:closes?|fixes?|resolves?)\s+#(\d+)", re.IGNORECASE
    )
    return [int(m) for m in pattern.findall(body or "")]


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    if not event_path or not os.path.exists(event_path):
        print("error: GITHUB_EVENT_PATH not set or missing", file=sys.stderr)
        return 2

    with open(event_path) as fh:
        event = json.load(fh)

    pr = event.get("pull_request") or {}
    repo = event.get("repository") or {}
    owner_repo = f"{repo.get('full_name', 'criptogus/HermesOffice')}"
    action = pr.get("action") or event.get("action")
    merged = bool(pr.get("merged", False))
    body = pr.get("body") or ""

    # Nothing to do for non-PR events or unmerged closes.
    if action == "closed" and not merged:
        print(f"info: PR #{pr.get('number')} closed without merge — no status change")
        return 0

    if action == "closed" and merged:
        target = STATUS_DONE
    elif action in ACTION_OPEN:
        target = STATUS_IN_PROGRESS
    else:
        print(f"info: action '{action}' not mapped — no status change")
        return 0

    issues = extract_linked_issues(body)
    if not issues:
        print(f"info: PR #{pr.get('number')} references no issues (Closes/Fixes/Resolves)")
        return 0

    print(f"info: PR #{pr.get('number')} ({action}, merged={merged}) → {target} for issues {issues}")

    field = get_status_field()
    items = board_items()
    changed = 0
    for number in issues:
        item_id = items.get(number)
        if item_id is None:
            print(f"warn: issue #{number} not on the board — skipping")
            continue
        node_id = issue_node_id(owner_repo, number)
        if node_id is None:
            print(f"warn: issue #{number} not found in repo — skipping")
            continue
        if dry_run:
            print(f"[dry-run] would set issue #{number} → {target}")
            continue
        set_item_status(field, item_id, target)
        print(f"ok: issue #{number} → {target}")
        changed += 1

    print(f"info: {changed} item(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
