from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ToolSpec:
    name: str
    mutating: bool
    approval_required: bool
    timeout_seconds: int


SAFE_TOOLS = {
    item.name: item
    for item in (
        ToolSpec("read_file", False, False, 10),
        ToolSpec("list_files", False, False, 10),
        ToolSpec("write_file", True, False, 10),
        ToolSpec("patch_file", True, False, 10),
        ToolSpec("run_tests", False, False, 300),
        ToolSpec("git_status", False, False, 30),
        ToolSpec("git_diff", False, False, 30),
        ToolSpec("git_push", True, True, 120),
        ToolSpec("deploy_service", True, True, 600),
    )
}


def resolve_workspace_path(workspace: Path, requested: str) -> Path:
    root = workspace.resolve()
    candidate = (root / requested).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path traversal is blocked")
    return candidate
