# Archive-Ops Integration Guide

A TypeScript library for archive operations via 7za CLI with security hardening, queue management, and progress reporting.

## Features

- **ZIP archive support** - Create, extract, list, update ZIP archives
- **Large file support** - Handles 70GB+ archives with ~4k entries
- **Security hardening** - Path traversal protection, encryption detection, `shell:false` spawn
- **Progress reporting** - Real-time progress callbacks (0-100%)
- **Queue management** - `ArchiveService` singleton with configurable concurrency
- **Configurable compression** - Store (0), Fast (1), Normal (5) levels
- **Cross-platform** - Windows and Linux support

## Requirements

- Node.js >= 18.0.0
- **7za executable** must be installed and accessible

## Installation

```bash
# Via yalc (local development)
yalc add archive-ops

# Via npm (when published)
npm install archive-ops
```

---

## Quick Start

### Direct API Usage (ArchiveOps)

```typescript
import { ArchiveOps, CompressionLevel } from 'archive-ops';

const ops = new ArchiveOps({
    executablePath: '7za'  // or full path: 'C:/Program Files/7-Zip/7za.exe'
});

// List archive contents
const listResult = await ops.listEntries('./archive.zip');
console.log(`Found ${listResult.files.length} files`);

// Extract archive
const extractResult = await ops.decompress(
    './archive.zip',
    './output',
    undefined,  // fileList (optional - extract specific files)
    (progress, message) => console.log(`${progress}%: ${message}`)
);

// Create archive from multiple sources (files and/or directories)
const compressResult = await ops.compress(
    ['./dir1', './dir2', './file.txt'],  // Mix of directories and files
    './output.zip',
    CompressionLevel.FAST,
    (progress, message) => console.log(`${progress}%: ${message}`)
);

// Create archive with no compression (fastest, ideal for media)
const mediaResult = await ops.compress(
    ['./images', './videos'],
    './media.zip',
    CompressionLevel.STORE  // No compression, just packaging
);
```

### Queue-Managed Usage (ArchiveService)

```typescript
import { ArchiveService } from 'archive-ops';

// Initialize singleton (once at app startup)
const service = ArchiveService.getInstance({
    executablePath: '7za',
    maxConcurrent: 2  // 1 for HDD, 2+ for NVMe
});

// Submit jobs (returns immediately)
const job1 = service.submitList('./archive1.zip');
const job2 = service.submitList('./archive2.zip');
const job3 = service.submitDecompress('./archive3.zip', './output3');

// Check queue status
const status = service.getStatus();
console.log(`Active: ${status.active}, Queued: ${status.queued}`);

// Wait for results
const result1 = await job1.promise;
const result2 = await job2.promise;

// Cancel a job
job3.cancel();

// Cleanup (at app shutdown)
ArchiveService.destroy();
```

### Queue with Progress Reporting

```typescript
import { ArchiveService } from 'archive-ops';

const service = ArchiveService.getInstance({
    executablePath: '7za',
    maxConcurrent: 2
});

// Submit decompress job with progress callback
const job = service.submitDecompress('./large-archive.zip', './output', {
    onProgress: (progress, message) => {
        console.log(`[${progress ?? '...'}%] ${message}`);
        // Update UI, log to file, etc.
    }
});

// Submit compress job with progress callback
const compressJob = service.submitCompress(
    ['./folder1', './folder2'],
    './backup.zip',
    {
        level: CompressionLevel.NORMAL,
        onProgress: (progress, message) => {
            progressBar.setValue(progress ?? 0);
            statusLabel.setText(message);
        }
    }
);

await Promise.all([job.promise, compressJob.promise]);
```

---

## Defaults

| Setting | Default | Notes |
|---------|---------|-------|
| Compression level | `CompressionLevel.FAST` (1) | Use `STORE` (0) for pre-compressed media |
| Max concurrent | 1 | Set via `ArchiveServiceConfig.maxConcurrent` |
| Overwrite mode | Always overwrite | Uses 7za `-aoa` flag |
| Archive format | ZIP only | `.zip` extension required |

---

## API Reference

### ArchiveOps (Worker Class)

Create one instance per operation, or reuse sequentially.

```typescript
interface ArchiveOpsConfig {
    executablePath: string;  // Path to 7za executable
}

class ArchiveOps {
    constructor(config: ArchiveOpsConfig);

    listEntries(archivePath: string): Promise<ArchiveOpResult>;

    decompress(
        archivePath: string,
        targetPath: string,
        fileList?: string[],           // Optional: extract specific files
        onProgress?: ProgressCallback
    ): Promise<ArchiveOpResult>;

    compress(
        sourceFiles: string[],
        archivePath: string,
        level?: CompressionLevel,      // Default: FAST (1)
        onProgress?: ProgressCallback
    ): Promise<ArchiveOpResult>;

    extractSingle(
        archivePath: string,
        entryPath: string,
        destPath: string
    ): Promise<ArchiveOpResult>;

    update(
        archivePath: string,
        sourceFiles: string[]
    ): Promise<ArchiveOpResult>;

    cancel(): void;
    getStatus(): { status: ProcessStatus; message: string };
}
```

### ArchiveService (Queue Manager)

Singleton that manages concurrent operations.

```typescript
interface ArchiveServiceConfig {
    executablePath: string;
    maxConcurrent: number;  // 1 for HDD, 2+ for NVMe
}

class ArchiveService {
    static getInstance(config?: ArchiveServiceConfig): ArchiveService;
    static destroy(): void;

    submitList(archivePath: string): JobHandle;
    submitDecompress(src: string, dst: string, options?: DecompressOptions): JobHandle;
    submitCompress(srcs: string[], dst: string, options?: CompressOptions): JobHandle;
    submitExtractSingle(archive: string, entry: string, dest: string): JobHandle;
    submitUpdate(archive: string, files: string[]): JobHandle;

    getStatus(): { active: number; queued: number; total: number };
    cancelJob(jobId: string): boolean;
    cancelAll(): void;
}
```

### Result Types

```typescript
interface ArchiveOpResult {
    success: boolean;
    runtime: number;           // Seconds elapsed
    type: ArchiveOpType;
    message: string;           // Human-readable status
    files: FileInfo[];         // Processed files
    basePath?: string;         // Base directory for path reconstruction
    exitCode?: number;         // 7za exit code
}

interface FileInfo {
    filename: string;          // Relative path in archive (e.g., "folder/file.jpg")
    size: number;              // Uncompressed size in bytes
    compressedSize?: number;
    date: Date;
    encrypted?: boolean;
    crc?: string;
}

interface JobHandle {
    jobId: string;
    status: ProcessStatus;
    promise: Promise<ArchiveOpResult>;
    cancel: () => void;
}

type ProgressCallback = (progress: number | null, message: string) => void;

interface DecompressOptions {
    fileList?: string[];           // Extract specific files only
    onProgress?: ProgressCallback; // Progress reporting
}

interface CompressOptions {
    level?: CompressionLevel;      // Compression level (default: FAST)
    onProgress?: ProgressCallback; // Progress reporting
}
```

### Compression Levels

```typescript
enum CompressionLevel {
    STORE = 0,   // No compression (fastest, use for media files)
    FAST = 1,    // Fast compression (default)
    NORMAL = 5,  // Better compression, slower
}
```

---

## Best Practices

### 1. Choose the Right Class

| Use Case | Class | Why |
|----------|-------|-----|
| Single operation | `ArchiveOps` | Direct, simple |
| Multiple concurrent ops | `ArchiveService` | Manages queue, prevents disk thrashing |
| Background processing | `ArchiveService` | Non-blocking job submission |

### 2. Set Appropriate Concurrency

```typescript
// HDD: Sequential I/O is faster
const service = ArchiveService.getInstance({
    executablePath: '7za',
    maxConcurrent: 1
});

// NVMe/SSD: Can handle parallel I/O
const service = ArchiveService.getInstance({
    executablePath: '7za',
    maxConcurrent: 2  // or more
});
```

### 3. Use Store Level for Pre-Compressed Media

```typescript
// Images, videos, and already-compressed files won't compress further
// Use STORE (0) for speed
await ops.compress(
    ['./video.mp4', './image.jpg'],
    './media.zip',
    CompressionLevel.STORE  // Instant, no CPU overhead
);
```

### 4. Handle Progress for Large Archives

```typescript
await ops.decompress('./large.zip', './output', undefined, (progress, message) => {
    // Update UI
    progressBar.value = progress;
    statusText.innerText = message;

    // Or log periodically
    if (progress % 10 === 0) {
        console.log(message);
    }
});
```

### 5. Always Clean Up ArchiveService

```typescript
// At application shutdown
process.on('SIGTERM', () => {
    ArchiveService.destroy();  // Cancels all jobs, cleans up
    process.exit(0);
});
```

---

## Gotchas & Common Issues

### 1. 7za Not Found

**Error:** `ExecutableNotFoundError: 7za executable not found`

**Solution:** Provide the full path to 7za:
```typescript
// Windows
new ArchiveOps({ executablePath: 'C:/Program Files/7-Zip/7za.exe' });

// Linux
new ArchiveOps({ executablePath: '/usr/bin/7za' });
```

### 2. Only ZIP Format Supported

**Error:** `UnsupportedFormatError: Unsupported archive format: .7z`

**Solution:** This library only supports `.zip` files. Convert other formats first.

### 3. Encrypted Archives Are Rejected

**Error:** `EncryptedArchiveError: Archive is encrypted and cannot be processed`

**Solution:** This is intentional - encrypted archives require interactive password input which would hang the process. Decrypt the archive first or use a different tool.

### 4. Path Traversal Protection

**Error:** `PathTraversalError: Path traversal detected in archive entry`

**Solution:** This is a security feature. The archive contains malicious paths like `../../../etc/passwd`. Do not extract untrusted archives without inspection.

### 5. ArchiveService Requires Config on First Call

**Error:** `ArchiveService requires config on first initialization`

**Solution:** Pass config on the first `getInstance()` call:
```typescript
// First call - config required
const service = ArchiveService.getInstance({
    executablePath: '7za',
    maxConcurrent: 1
});

// Subsequent calls - config optional
const sameService = ArchiveService.getInstance();
```

### 6. Files Use Relative Paths

**Gotcha:** `FileInfo.filename` contains paths relative to the archive root.

**Solution:** Use `basePath` to reconstruct full paths:
```typescript
const result = await ops.decompress('./archive.zip', './output');

for (const file of result.files) {
    const fullPath = `${result.basePath}/${file.filename}`;
    console.log(fullPath);  // ./output/folder/image.jpg
}
```

### 7. Progress Callback Frequency

**Gotcha:** Progress callbacks may fire rapidly or skip values (e.g., 10%, 50%, 100%).

**Solution:** Debounce UI updates if needed:
```typescript
let lastUpdate = 0;
await ops.decompress('./archive.zip', './output', undefined, (progress, message) => {
    const now = Date.now();
    if (now - lastUpdate > 100) {  // Max 10 updates/second
        updateUI(progress, message);
        lastUpdate = now;
    }
});
```

---

## CLI Testing

The library includes a CLI runner for testing all operations:

```bash
# Show help
npx tsx src/cli/runner.ts --help
```

### List Archive Contents

```bash
# Basic list
npx tsx src/cli/runner.ts list ./archive.zip

# With custom 7za path
npx tsx src/cli/runner.ts --7za="C:/Program Files/7-Zip/7za.exe" list ./archive.zip
```

### Extract Archives

```bash
# Extract entire archive
npx tsx src/cli/runner.ts decompress ./archive.zip ./output

# Extract single file from archive
npx tsx src/cli/runner.ts extract ./archive.zip "folder/file.txt" ./extracted
```

### Create Archives

```bash
# Single source directory
npx tsx src/cli/runner.ts compress ./source ./output.zip

# Multiple sources (directories and files)
npx tsx src/cli/runner.ts compress ./dir1 ./dir2 ./file.txt ./bundle.zip

# No compression (fastest, for media files)
npx tsx src/cli/runner.ts --level=0 compress ./images ./videos ./media.zip

# Normal compression (smaller size, slower)
npx tsx src/cli/runner.ts --level=5 compress ./documents ./docs.zip
```

### Update Archives

```bash
# Add or update files in existing archive
npx tsx src/cli/runner.ts update ./archive.zip ./newfile.txt ./another.txt
```

### Queue Testing

Test `ArchiveService` queue management with concurrent operations:

```bash
# List mode - lists multiple archives concurrently
npx tsx src/cli/runner.ts -c 2 queue-test ./a.zip ./b.zip ./c.zip

# Decompress mode - extracts archives to destination with progress
# Each archive extracts to: <destination>/<archive-basename>/
npx tsx src/cli/runner.ts -c 2 queue-test ./a.zip ./b.zip ./c.zip ./output
# Results in: ./output/a/, ./output/b/, ./output/c/
```

**Decompress mode** shows real-time progress for each archive:
```
Queue test with 3 archives
Mode: decompress
Destination: ./output
Concurrency: 2
Using 7za at: 7za

  [1] a.zip: 45% - Extracting 'a.zip'...
  [2] b.zip: 12% - Extracting 'b.zip'...
  [3] c.zip: queued

Queue status: {"active":2,"queued":1,"total":3}
```

### CLI Options

| Option | Short | Description | Default |
|--------|-------|-------------|---------|
| `--7za <path>` | | Path to 7za executable | `7za` |
| `--level <0\|1\|5>` | | Compression: 0=store, 1=fast, 5=normal | `1` |
| `--concurrency <n>` | `-c` | Max concurrent jobs (queue-test only) | `1` |
| `--help` | `-h` | Show help | |

### Platform-Specific 7za Paths

```bash
# Windows (7-Zip installed)
npx tsx src/cli/runner.ts --7za="C:/Program Files/7-Zip/7za.exe" list ./test.zip

# Linux (p7zip package)
npx tsx src/cli/runner.ts --7za="/usr/bin/7za" list ./test.zip

# macOS (Homebrew)
npx tsx src/cli/runner.ts --7za="/usr/local/bin/7za" list ./test.zip
```

---

## Error Handling

All errors extend `ArchiveError` with a `code` property:

```typescript
import { ArchiveError, ArchiveErrorCode } from 'archive-ops';

try {
    await ops.decompress('./archive.zip', './output');
} catch (error) {
    if (error instanceof ArchiveError) {
        switch (error.code) {
            case ArchiveErrorCode.FILE_NOT_FOUND:
                console.error('Archive not found');
                break;
            case ArchiveErrorCode.ENCRYPTED_ARCHIVE:
                console.error('Cannot process encrypted archive');
                break;
            case ArchiveErrorCode.PATH_TRAVERSAL:
                console.error('Security: malicious archive detected');
                break;
            default:
                console.error(`Archive error: ${error.message}`);
        }
    }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `FILE_NOT_FOUND` | Archive or source file not found |
| `DIRECTORY_NOT_FOUND` | Target directory cannot be created |
| `ENCRYPTED_ARCHIVE` | Archive requires password |
| `PATH_TRAVERSAL` | Malicious paths detected |
| `UNSUPPORTED_FORMAT` | Not a .zip file |
| `EMPTY_ARCHIVE` | Archive has no files |
| `CORRUPT_ARCHIVE` | Archive is damaged |
| `EXECUTABLE_NOT_FOUND` | 7za not found at specified path |
| `OPERATION_IN_PROGRESS` | ArchiveOps instance busy |
| `FATAL_ERROR` | 7za exit code 2 |
| `COMMAND_LINE_ERROR` | 7za exit code 7 |
| `OUT_OF_MEMORY` | 7za exit code 8 |
