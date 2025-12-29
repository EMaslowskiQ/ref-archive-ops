# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Operational Rules
- **NO Git Operations:** Do not create commits or push. Save files only.
- **No Meta-Discussion:** Do not refer to project plans, steps, or "as planned."
- **Focus:** Code function and purpose only.
- **Comments:** Explain *what* code achieves, not *how* it fits a plan. Concise.
- **Post-Task Summary:** At the end of every response where changes are made, provide a git commit message block:
    - **Title:** Meaningful, under 50 characters.
    - **Bullets:** Under 70 characters. Use `(new)` for additions, `(fix)` for fixes.
    - **Order:** Group all `(new)` items first, then `(fix)` items.

## Project Overview

TypeScript Node.js library wrapping 7-zip for archive operations. Spawns child processes to interact with 7-zip CLI and intercepts stdio for progress monitoring and error handling.

**External Dependency**: Requires 7-zip (`7z`) installed and available in system PATH.

## Commands

```bash
# Run TypeScript directly (no build step configured)
npx ts-node --esm src/index.ts <source-path>

# Type checking only (noEmit is true in tsconfig)
npx tsc --project src/tsconfig.json
```

## Architecture

### Core Module: `src/system/util/archiveOps.ts`

The `ArchiveOps` class provides three operations:
- `compress(sourceFiles, archivePath, onProgress?, onEnd?)` - Create archives
- `decompress(archivePath, targetPath, onProgress?, onEnd?)` - Extract archives
- `listEntries(archivePath, onEnd?)` - List archive contents

All operations return `Promise<ArchiveOpResult>` with success status, runtime, message, and file list. Uses internal state machine (`ProcessStatus` enum) to prevent concurrent operations.

### 7-zip Integration

Flags used: `-bsp1` (progress to stdout), `-bso0` (disable messages), `-ba` (no table formatting), `-mx1` (fast compression).

Supported formats: `.zip`, `.7z`, `.rar`

### File Structure
1.  **Header:** First line must be `// path/from/root/file.ts`.
2.  **Regions:** Organize via `//#region NAME` ... `//#endregion`.
    *   Order: `IMPORTS`, `TYPES`, `PROPERTIES`, `CONSTRUCTOR & INIT`, `PUBLIC API`, `HOOKS`, `INTERNAL`.
3.  **Imports:** Grouped logic. Use `type` for interfaces.

### Coding Standards
*   **Classes/Interfaces:** PascalCase (`ArchiveOps`).
*   **Methods/Props:** camelCase (`writeChunk`).
*   **Modifiers:** Explicit `public`, `private`, `protected`. Use `override` and `readonly`.
*   **Async:** Explicit `void` for fire-and-forget; `await` otherwise.
*   **Types:** Explicit return types and parameter types.
*   **Error Handling:** Throw `Error` with context + method name.

### Documentation
*   **Class:** Multi-line JSDoc describing role/behavior.
*   **Methods:** Single-line JSDoc for simple, multi-line for complex logic.
*   **Inline:** Single-line `//` describing *intent* (WHAT), not mechanics.
