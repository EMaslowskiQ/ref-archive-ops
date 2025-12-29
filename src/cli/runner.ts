#!/usr/bin/env node
// src/cli/runner.ts
import { parseArgs } from 'util';
import path from 'path';
import { ArchiveOps, ArchiveService, CompressionLevel } from '../index.js';

//#region TYPES

interface ParsedArgs {
    values: {
        '7za'?: string;
        level?: string;
        concurrency?: string;
        help?: boolean;
    };
    positionals: string[];
}

//#endregion

//#region MAIN

async function main(): Promise<void> {
    const { values, positionals } = parseArgs({
        options: {
            '7za': { type: 'string', default: '7za' },
            'level': { type: 'string', default: '1' },
            'concurrency': { type: 'string', short: 'c', default: '1' },
            'help': { type: 'boolean', short: 'h', default: false },
        },
        allowPositionals: true,
    }) as ParsedArgs;

    if (values.help || positionals.length === 0) {
        printHelp();
        process.exit(0);
    }

    const [command, ...args] = positionals;
    const execPath = values['7za'] ?? '7za';

    try {
        switch (command) {
            case 'list':
                await handleList(execPath, args);
                break;
            case 'decompress':
                await handleDecompress(execPath, args);
                break;
            case 'compress':
                await handleCompress(execPath, args, parseInt(values.level ?? '1', 10));
                break;
            case 'extract':
                await handleExtractSingle(execPath, args);
                break;
            case 'update':
                await handleUpdate(execPath, args);
                break;
            case 'queue-test':
                await handleQueueTest(execPath, args, parseInt(values.concurrency ?? '1', 10));
                break;
            default:
                console.error(`Unknown command: ${command}`);
                printHelp();
                process.exit(1);
        }
    } catch (error) {
        console.error('\nError:', error instanceof Error ? error.message : String(error));
        if (error instanceof Error && error.stack) {
            console.error('\nStack:', error.stack);
        }
        process.exit(1);
    }
}

//#endregion

//#region COMMAND HANDLERS

async function handleList(execPath: string, args: string[]): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: list <archive>');
        process.exit(1);
    }

    const archivePath = args[0];
    console.log(`Listing contents of: ${archivePath}`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.listEntries(archivePath);

    console.log(`Found ${result.files.length} files:\n`);

    for (const file of result.files) {
        const sizeStr = formatSize(file.size).padStart(10);
        const dateStr = file.date.toISOString().split('T')[0];
        console.log(`  ${sizeStr}  ${dateStr}  ${file.filename}`);
    }

    console.log(`\nRuntime: ${result.runtime.toFixed(2)}s`);
    console.log(`Base path: ${result.basePath}`);
}

async function handleDecompress(execPath: string, args: string[]): Promise<void> {
    if (args.length < 2) {
        console.error('Usage: decompress <archive> <destination>');
        process.exit(1);
    }

    const [archivePath, destPath] = args;
    console.log(`Extracting: ${archivePath}`);
    console.log(`To: ${destPath}`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.decompress(archivePath, destPath, undefined, (progress, message) => {
        process.stdout.write(`\r${message.padEnd(60)}`);
    });

    console.log(`\n\nExtracted ${result.files.length} files`);
    console.log(`Runtime: ${result.runtime.toFixed(2)}s`);
    console.log(`Base path: ${result.basePath}`);
}

async function handleCompress(execPath: string, args: string[], level: number): Promise<void> {
    if (args.length < 2) {
        console.error('Usage: compress <source1> [source2] ... <archive>');
        process.exit(1);
    }

    // Last arg is archive, all others are sources
    const archivePath = args[args.length - 1];
    const sourcePaths = args.slice(0, -1);
    const compressionLevel = level as CompressionLevel;

    console.log(`Compressing ${sourcePaths.length} source(s):`);
    sourcePaths.forEach(s => console.log(`  - ${s}`));
    console.log(`To: ${archivePath}`);
    console.log(`Level: ${compressionLevel} (${getLevelName(compressionLevel)})`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.compress(sourcePaths, archivePath, compressionLevel, (progress, message) => {
        process.stdout.write(`\r${message.padEnd(60)}`);
    });

    console.log(`\n\nCreated archive: ${result.files[0]?.filename}`);
    console.log(`Size: ${formatSize(result.files[0]?.size ?? 0)}`);
    console.log(`Runtime: ${result.runtime.toFixed(2)}s`);
}

async function handleExtractSingle(execPath: string, args: string[]): Promise<void> {
    if (args.length < 3) {
        console.error('Usage: extract <archive> <entry-path> <destination>');
        process.exit(1);
    }

    const [archivePath, entryPath, destPath] = args;
    console.log(`Extracting: ${entryPath}`);
    console.log(`From: ${archivePath}`);
    console.log(`To: ${destPath}`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.extractSingle(archivePath, entryPath, destPath);

    console.log(`Extracted to: ${result.basePath}`);
    console.log(`Runtime: ${result.runtime.toFixed(2)}s`);
}

async function handleUpdate(execPath: string, args: string[]): Promise<void> {
    if (args.length < 2) {
        console.error('Usage: update <archive> <file1> [file2] ...');
        process.exit(1);
    }

    const [archivePath, ...sourceFiles] = args;
    console.log(`Updating: ${archivePath}`);
    console.log(`With files: ${sourceFiles.join(', ')}`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.update(archivePath, sourceFiles);

    console.log(`Updated archive: ${path.basename(archivePath)}`);
    console.log(`Runtime: ${result.runtime.toFixed(2)}s`);
}

async function handleQueueTest(execPath: string, args: string[], concurrency: number): Promise<void> {
    if (args.length < 1) {
        console.error('Usage: queue-test <archive1> [archive2] ... [destination]');
        console.error('  If destination is provided (not a .zip), archives are extracted there.');
        console.error('  Each archive extracts to: <destination>/<archive-basename>/');
        process.exit(1);
    }

    // Check if last arg is a destination (not a .zip file)
    const lastArg = args[args.length - 1];
    const isDecompressMode = !lastArg.toLowerCase().endsWith('.zip');

    let archives: string[];
    let destBase: string | undefined;

    if (isDecompressMode) {
        if (args.length < 2) {
            console.error('Usage: queue-test <archive1> [archive2] ... <destination>');
            process.exit(1);
        }
        archives = args.slice(0, -1);
        destBase = lastArg;
    } else {
        archives = args;
    }

    console.log(`Queue test with ${archives.length} archives`);
    console.log(`Mode: ${isDecompressMode ? 'decompress' : 'list'}`);
    if (destBase) {
        console.log(`Destination: ${destBase}`);
    }
    console.log(`Concurrency: ${concurrency}`);
    console.log(`Using 7za at: ${execPath}\n`);

    const service = ArchiveService.getInstance({
        executablePath: execPath,
        maxConcurrent: concurrency,
    });

    // Track progress for each archive
    const progressState: Map<number, { progress: number | null; message: string }> = new Map();

    // Helper to print current progress state
    const printProgress = () => {
        const lines = archives.map((archive, index) => {
            const state = progressState.get(index);
            const name = path.basename(archive);
            if (!state) {
                return `  [${index + 1}] ${name}: queued`;
            }
            const pct = state.progress !== null ? `${state.progress}%` : '...';
            return `  [${index + 1}] ${name}: ${pct} - ${state.message}`;
        });
        // Clear previous lines and print new state
        process.stdout.write(`\r\x1b[${archives.length}A`); // Move cursor up
        lines.forEach(line => console.log(line.padEnd(80)));
    };

    // Submit all jobs
    const jobs = archives.map((archive, index) => {
        const archiveName = path.basename(archive);
        console.log(`  [${index + 1}] ${archiveName}: queued`.padEnd(80));

        if (isDecompressMode && destBase) {
            // Extract to <destBase>/<archiveBaseName>/
            const baseName = path.basename(archive, path.extname(archive));
            const destPath = path.join(destBase, baseName);
            return {
                archive,
                destPath,
                handle: service.submitDecompress(archive, destPath, {
                    onProgress: (progress, message) => {
                        progressState.set(index, { progress, message });
                        printProgress();
                    },
                }),
            };
        } else {
            return {
                archive,
                destPath: undefined,
                handle: service.submitList(archive),
            };
        }
    });

    console.log(`\nQueue status: ${JSON.stringify(service.getStatus())}`);

    // Wait for all jobs
    const results = await Promise.allSettled(jobs.map(j => j.handle.promise));

    console.log('\n\nResults:');
    results.forEach((result, index) => {
        const archive = path.basename(jobs[index].archive);
        if (result.status === 'fulfilled') {
            if (isDecompressMode) {
                console.log(`  [${index + 1}] ${archive}: extracted ${result.value.files.length} files to ${jobs[index].destPath} (${result.value.runtime.toFixed(2)}s)`);
            } else {
                console.log(`  [${index + 1}] ${archive}: ${result.value.files.length} files (${result.value.runtime.toFixed(2)}s)`);
            }
        } else {
            console.log(`  [${index + 1}] ${archive}: ERROR - ${result.reason}`);
        }
    });

    console.log(`\nFinal status: ${JSON.stringify(service.getStatus())}`);

    // Cleanup
    ArchiveService.destroy();
}

//#endregion

//#region UTILITIES

function printHelp(): void {
    console.log(`
Archive-Ops CLI Runner

Usage: npx tsx src/cli/runner.ts [options] <command> [args]

Commands:
  list <archive>                       List archive contents
  decompress <archive> <destination>   Extract archive to directory
  compress <src1> [src2...] <archive>  Compress files/dirs to archive
  extract <archive> <entry> <dest>     Extract single file from archive
  update <archive> <file1> [...]       Add/update files in archive
  queue-test <archive1> [...] [dest]   Test queue (list mode, or decompress if dest provided)

Options:
  --7za <path>        Path to 7za executable (default: 7za)
  --level <0|1|5>     Compression level: 0=store, 1=fast, 5=normal (default: 1)
  -c, --concurrency   Max concurrent jobs for queue-test (default: 1)
  -h, --help          Show this help message

Examples:
  # List archive contents
  npx tsx src/cli/runner.ts list ./test.zip

  # Extract with custom 7za path
  npx tsx src/cli/runner.ts --7za="C:/Program Files/7-Zip/7za.exe" decompress ./test.zip ./output

  # Compress single source
  npx tsx src/cli/runner.ts compress ./source ./output.zip

  # Compress multiple directories into one archive
  npx tsx src/cli/runner.ts compress ./dir1 ./dir2 ./dir3 ./combined.zip

  # Compress with store level (no compression, fastest)
  npx tsx src/cli/runner.ts --level=0 compress ./source ./output.zip

  # Extract single file
  npx tsx src/cli/runner.ts extract ./archive.zip "folder/file.txt" ./output

  # Test queue - list mode (concurrency=2)
  npx tsx src/cli/runner.ts -c 2 queue-test ./a.zip ./b.zip ./c.zip

  # Test queue - decompress mode (extracts to ./output/a/, ./output/b/, ./output/c/)
  npx tsx src/cli/runner.ts -c 2 queue-test ./a.zip ./b.zip ./c.zip ./output
`);
}

function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function getLevelName(level: CompressionLevel): string {
    switch (level) {
        case CompressionLevel.STORE: return 'store';
        case CompressionLevel.FAST: return 'fast';
        case CompressionLevel.NORMAL: return 'normal';
        default: return 'unknown';
    }
}

//#endregion

// Run main
main();
