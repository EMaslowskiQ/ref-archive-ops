# Archiver Updates

### 1. Requirements

*   **Format & Scale:** **ZIP only** (via `7za` CLI), supporting **70GB+** files and **~4k entries**.
*   **Operations:** Compress, Decompress, List, **Extract Single File**, **Add/Update Single File**.
*   **Compression:** Configurable levels: **Store** (0) for speed, Fast (1), and Normal (5).
*   **Security:**
    *   **Input Sanitization:** Protect against Command Injection (`shell:false`).
    *   **Path Traversal:** Validate entry paths inside untrusted archives (block `../` or absolute paths) *before* extraction.
    *   **Encryption:** Detect and reject encrypted archives with a specific error (no interactive password prompts).
*   **Concurrency:**
    *   **Non-blocking:** Core Ops must not block the Event Loop.
    *   **Managed:** Global limit of **1** (HDD) or **2** (NVMe) concurrent operations via a Service/Queue.
    *   **State:** Map internal states to **QUEUED** (Waiting) vs **RUNNING**.
*   **Environment:** Windows & Linux support with deterministic executable paths.

---

### 2. Configuration

#### **ArchiveOpsConfig** (Worker Configuration)
```typescript
interface ArchiveOpsConfig {
    executablePath: string;  // Absolute path to 7za executable
}
```

#### **ArchiveServiceConfig** (Manager Configuration)
```typescript
interface ArchiveServiceConfig {
    executablePath: string;  // Passed to each ArchiveOps worker
    maxConcurrent: number;   // 1 for HDD, 2+ for NVMe
}
```

---

### 3. Return Types

#### **ArchiveOpResult** (All operations return this)
```typescript
interface ArchiveOpResult {
    success: boolean;
    runtime: number;
    type: ArchiveOpType;
    message: string;
    files: FileInfo[];
    basePath?: string;    // Base directory for path reconstruction
    exitCode?: number;    // 7za exit code for diagnostics
}
```

#### **FileInfo** (Relative paths only)
```typescript
interface FileInfo {
    date: Date;
    size: number;
    compressedSize?: number;  // From -slt output
    filename: string;         // Relative path (e.g., "masks/image_01.jpg")
    encrypted?: boolean;      // For encryption detection
}
```

*   **Path Convention:** `FileInfo.filename` contains relative paths within the archive. Consumers reconstruct full paths using `basePath + filename`.

---

### 4. Class Methods

#### **A. ArchiveOps** (The Worker - Instance per Job)
*   `constructor(config: ArchiveOpsConfig)`
    Creates worker with configured 7za executable path.
*   `listEntries(archivePath): Promise<ArchiveOpResult>`
    Parses archive contents using `-slt` flag for robust metadata.
*   `decompress(archivePath, destPath, fileList?, onProgress?): Promise<ArchiveOpResult>`
    Extracts all files (or specific `fileList` if provided) to destination.
*   `compress(sourceFiles, archivePath, level?, onProgress?): Promise<ArchiveOpResult>`
    Creates or updates an archive with the provided source files.
*   `extractSingle(archivePath, entryPath, destPath): Promise<ArchiveOpResult>`
    Extracts a single file from an archive.
*   `update(archivePath, sourceFiles): Promise<ArchiveOpResult>`
    Adds or replaces specific files within an existing archive.
*   `validateEntryPaths(entries): void`
    Security check; throws `PathTraversalError` if archive contains malicious paths.
*   `cancel(): void`
    Cancels the current operation.

#### **B. ArchiveService** (The Manager - Singleton)
*   `static getInstance(config?: ArchiveServiceConfig): ArchiveService`
    Gets or creates the singleton instance.
*   `static destroy(): void`
    Destroys the singleton and cancels all jobs.
*   `submitDecompress(src, dst, options?): JobHandle`
    Validates request, adds to queue, returns handle with promise.
*   `submitCompress(srcs, dst, options?): JobHandle`
    Enqueues a compression job.
*   `submitList(src): JobHandle`
    Enqueues a listing job.
*   `submitExtractSingle(archive, entry, dest): JobHandle`
    Enqueues a single-file extraction job.
*   `submitUpdate(archive, files): JobHandle`
    Enqueues an update job.
*   `getStatus(): { active: number, queued: number }`
    Metrics for the Workflow Engine or Health Checks.
*   `cancelJob(jobId): boolean`
    Cancels a specific job.
*   `cancelAll(): void`
    Cancels all pending and running jobs.

#### **C. JobHandle** (Returned by submit methods)
```typescript
interface JobHandle {
    jobId: string;
    status: ProcessStatus;
    promise: Promise<ArchiveOpResult>;
    cancel: () => void;
}
```

---

### 5. Core Implementation Changes (`ArchiveOps`)

*   **`shell: false`**
    **Why:** Prevents command injection and quoting issues; enables reliable process cancellation.
*   **`7za` + Absolute Path (via constructor)**
    **Why:** Ensures deterministic execution across Windows/Linux; avoids `PATH` variable ambiguity.
*   **`-slt` Flag**
    **Why:** Outputs flat "Key=Value" blocks (machine-readable) instead of columns; handles spaces/long paths safely.
*   **Line-by-Line Parsing (`readline`)**
    **Why:** Prevents memory crashes on large file lists; enables streaming logic.
*   **Exit Code as Truth**
    **Why:** Ignores non-fatal `stderr` warnings; relies strictly on process exit codes (0=Success) for flow control.
*   **`-aoa` (Overwrite All)**
    **Why:** Enforces "Overwrite All" policy to prevent the process from hanging on interactive prompts.
*   **`-mx` Parameter Mapping**
    **Why:** Allows caller to select `-mx0` (Store/Copy) for instant archiving of already-compressed data (media).
*   **Encryption Detection**
    **Why:** Parses `-slt` output for `Encrypted = +` or checks exit code `2` to fail fast instead of hanging.
*   **Path Normalization (`path.normalize`)**
    **Why:** Replaces manual regex replacement; ensures cross-platform path safety ( `/` vs `\` ).
*   **Pre-extraction Validation**
    **Why:** Scans file list for `..` or absolute paths before spawning the extract command to prevent filesystem attacks.

---

### 6. File Structure

```
src/
├── index.ts                    # Public API exports
├── types/
│   ├── index.ts                # Type re-exports
│   ├── archive.types.ts        # ArchiveOpResult, FileInfo, configs, enums
│   └── errors.types.ts         # ArchiveError, ArchiveErrorCode, specific errors
├── core/
│   ├── ArchiveOps.ts           # Worker class
│   └── ArchiveService.ts       # Manager class
├── utils/
│   ├── pathValidation.ts       # Path traversal detection
│   └── sltParser.ts            # -slt output parser with readline
└── cli/
    └── runner.ts               # CLI test runner
```

---

### 7. CLI Testing

```bash
# List archive contents
npx tsx src/cli/runner.ts list ./test.zip

# Decompress with custom 7za path
npx tsx src/cli/runner.ts --7za="/path/to/7za" decompress ./test.zip ./output

# Compress with store level (no compression)
npx tsx src/cli/runner.ts --level=0 compress ./source ./output.zip

# Test queue with multiple archives
npx tsx src/cli/runner.ts --concurrency=2 queue-test ./a.zip ./b.zip ./c.zip
```
