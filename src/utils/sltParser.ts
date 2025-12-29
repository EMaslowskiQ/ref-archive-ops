// src/utils/sltParser.ts
import readline from 'readline';
import type { Readable } from 'stream';
import type { FileInfo } from '../types/archive.types.js';

//#region TYPES

/** Raw parsed data from -slt output for a single file */
interface SltFileEntry {
    path?: string;
    size?: number;
    packedSize?: number;
    modified?: string;
    encrypted?: string;
    crc?: string;
    attributes?: string;
}

//#endregion

//#region PUBLIC API

/**
 * Parses 7za -slt output stream into FileInfo array.
 * Uses readline for memory-safe line-by-line processing.
 *
 * -slt output format:
 * ```
 * Path = folder/file.txt
 * Size = 12345
 * Packed Size = 9876
 * Modified = 2024-01-15 10:30:00
 * Attributes = ....A
 * CRC = ABCD1234
 * Encrypted = +
 * ```
 */
export async function parseSltOutput(stdout: Readable): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    let currentEntry: SltFileEntry = {};

    const rl = readline.createInterface({
        input: stdout,
        crlfDelay: Infinity, // Handle both \n and \r\n
    });

    for await (const line of rl) {
        const trimmed = line.trim();

        // Empty line indicates end of current file entry
        if (trimmed === '') {
            const fileInfo = convertToFileInfo(currentEntry);
            if (fileInfo) {
                files.push(fileInfo);
            }
            currentEntry = {};
            continue;
        }

        // Parse key = value format
        const separatorIndex = trimmed.indexOf(' = ');
        if (separatorIndex === -1) continue;

        const key = trimmed.substring(0, separatorIndex);
        const value = trimmed.substring(separatorIndex + 3);

        switch (key) {
            case 'Path':
                currentEntry.path = value;
                break;
            case 'Size':
                currentEntry.size = parseInt(value, 10);
                break;
            case 'Packed Size':
                currentEntry.packedSize = parseInt(value, 10);
                break;
            case 'Modified':
                currentEntry.modified = value;
                break;
            case 'Encrypted':
                currentEntry.encrypted = value;
                break;
            case 'CRC':
                currentEntry.crc = value;
                break;
            case 'Attributes':
                currentEntry.attributes = value;
                break;
        }
    }

    // Don't forget the last entry if stream doesn't end with empty line
    const lastFileInfo = convertToFileInfo(currentEntry);
    if (lastFileInfo) {
        files.push(lastFileInfo);
    }

    return files;
}

/**
 * Synchronous parsing of -slt output from a string buffer.
 * Use for smaller archives or when stream parsing is not needed.
 */
export function parseSltString(output: string): FileInfo[] {
    const files: FileInfo[] = [];
    let currentEntry: SltFileEntry = {};

    const lines = output.split(/\r?\n/);

    for (const line of lines) {
        const trimmed = line.trim();

        // Empty line indicates end of current file entry
        if (trimmed === '') {
            const fileInfo = convertToFileInfo(currentEntry);
            if (fileInfo) {
                files.push(fileInfo);
            }
            currentEntry = {};
            continue;
        }

        // Parse key = value format
        const separatorIndex = trimmed.indexOf(' = ');
        if (separatorIndex === -1) continue;

        const key = trimmed.substring(0, separatorIndex);
        const value = trimmed.substring(separatorIndex + 3);

        switch (key) {
            case 'Path':
                currentEntry.path = value;
                break;
            case 'Size':
                currentEntry.size = parseInt(value, 10);
                break;
            case 'Packed Size':
                currentEntry.packedSize = parseInt(value, 10);
                break;
            case 'Modified':
                currentEntry.modified = value;
                break;
            case 'Encrypted':
                currentEntry.encrypted = value;
                break;
            case 'CRC':
                currentEntry.crc = value;
                break;
            case 'Attributes':
                currentEntry.attributes = value;
                break;
        }
    }

    // Don't forget the last entry
    const lastFileInfo = convertToFileInfo(currentEntry);
    if (lastFileInfo) {
        files.push(lastFileInfo);
    }

    return files;
}

/**
 * Checks if any file in the parsed list is encrypted.
 */
export function hasEncryptedFiles(files: FileInfo[]): boolean {
    return files.some(file => file.encrypted === true);
}

/**
 * Finds the first encrypted file in the list.
 */
export function findEncryptedFile(files: FileInfo[]): FileInfo | undefined {
    return files.find(file => file.encrypted === true);
}

//#endregion

//#region INTERNAL

/**
 * Converts raw SLT entry to FileInfo.
 * Returns null if entry is invalid (e.g., directory or missing path).
 */
function convertToFileInfo(entry: SltFileEntry): FileInfo | null {
    // Skip entries without a path
    if (!entry.path) {
        return null;
    }

    // Skip directories (they have 'D' in attributes or size is undefined/0 with no packed size)
    if (entry.attributes?.includes('D')) {
        return null;
    }

    // Parse the date from modified string (format: "2024-01-15 10:30:00")
    let date = new Date();
    if (entry.modified) {
        const parsed = new Date(entry.modified.replace(' ', 'T'));
        if (!isNaN(parsed.getTime())) {
            date = parsed;
        }
    }

    return {
        filename: entry.path,
        size: entry.size ?? 0,
        compressedSize: entry.packedSize,
        date,
        encrypted: entry.encrypted === '+',
        crc: entry.crc,
    };
}

//#endregion
