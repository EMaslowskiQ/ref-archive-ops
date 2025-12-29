#!/usr/bin/env node
// src/cli/runner.ts
import { parseArgs } from 'util';
import path from 'path';
import { ArchiveOps, CompressionLevel } from '../index.js';

//#region TYPES

interface ParsedArgs {
    values: {
        '7za'?: string;
        level?: string;
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
        console.error('Usage: compress <source> <archive>');
        process.exit(1);
    }

    const [sourcePath, archivePath] = args;
    const compressionLevel = level as CompressionLevel;

    console.log(`Compressing: ${sourcePath}`);
    console.log(`To: ${archivePath}`);
    console.log(`Level: ${compressionLevel} (${getLevelName(compressionLevel)})`);
    console.log(`Using 7za at: ${execPath}\n`);

    const ops = new ArchiveOps({ executablePath: execPath });
    const result = await ops.compress([sourcePath], archivePath, compressionLevel, (progress, message) => {
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

//#endregion

//#region UTILITIES

function printHelp(): void {
    console.log(`
Archive-Ops CLI Runner

Usage: npx tsx src/cli/runner.ts [options] <command> [args]

Commands:
  list <archive>                      List archive contents
  decompress <archive> <destination>  Extract archive to directory
  compress <source> <archive>         Compress file/dir to archive
  extract <archive> <entry> <dest>    Extract single file from archive
  update <archive> <file1> [...]      Add/update files in archive

Options:
  --7za <path>     Path to 7za executable (default: 7za)
  --level <0|1|5>  Compression level: 0=store, 1=fast, 5=normal (default: 1)
  -h, --help       Show this help message

Examples:
  # List archive contents
  npx tsx src/cli/runner.ts list ./test.zip

  # Extract with custom 7za path
  npx tsx src/cli/runner.ts --7za="C:/Program Files/7-Zip/7za.exe" decompress ./test.zip ./output

  # Compress with store level (no compression)
  npx tsx src/cli/runner.ts --level=0 compress ./source ./output.zip

  # Extract single file
  npx tsx src/cli/runner.ts extract ./archive.zip "folder/file.txt" ./output
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
