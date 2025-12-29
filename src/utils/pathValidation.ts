// src/utils/pathValidation.ts
import path from 'path';
import type { FileInfo } from '../types/archive.types.js';
import { PathTraversalError } from '../types/errors.types.js';

//#region PUBLIC API

/**
 * Validates a single entry path for path traversal attacks.
 * Throws PathTraversalError if the path is malicious.
 */
export function validateEntryPath(entryPath: string, archivePath: string): void {
    const normalized = path.normalize(entryPath);

    // Block absolute paths (e.g., C:\Windows\System32 or /etc/passwd)
    if (path.isAbsolute(normalized)) {
        throw new PathTraversalError(entryPath, archivePath);
    }

    // Block paths that escape the extraction directory
    // Catches: ../file, ..\\file, foo/../../../etc
    if (normalized.startsWith('..') || normalized.includes(`..${path.sep}`) || normalized.includes('../') || normalized.includes('..\\')) {
        throw new PathTraversalError(entryPath, archivePath);
    }

    // Block paths with null bytes (used in some attacks)
    if (entryPath.includes('\0')) {
        throw new PathTraversalError(entryPath, archivePath);
    }
}

/**
 * Validates all file entries in an archive for path traversal attacks.
 * Throws PathTraversalError on first malicious path found.
 */
export function validateAllEntries(entries: FileInfo[], archivePath: string): void {
    for (const entry of entries) {
        validateEntryPath(entry.filename, archivePath);
    }
}

/**
 * Normalizes a path for cross-platform consistency.
 * Converts backslashes to forward slashes and removes redundant separators.
 */
export function normalizePath(inputPath: string): string {
    // Use path.normalize for platform-specific normalization
    const normalized = path.normalize(inputPath);

    // Convert to forward slashes for consistent output
    return normalized.replace(/\\/g, '/');
}

/**
 * Checks if a path is safe for extraction (does not escape target directory).
 * Returns true if safe, false if potentially malicious.
 */
export function isSafePath(entryPath: string): boolean {
    try {
        validateEntryPath(entryPath, '');
        return true;
    } catch {
        return false;
    }
}

/**
 * Constructs the full output path for an extracted file.
 * Validates the path before returning.
 */
export function resolveExtractPath(basePath: string, relativePath: string, archivePath: string): string {
    // Validate first
    validateEntryPath(relativePath, archivePath);

    // Resolve the full path
    const fullPath = path.resolve(basePath, relativePath);

    // Double-check the resolved path is within basePath
    const normalizedBase = path.resolve(basePath);
    if (!fullPath.startsWith(normalizedBase)) {
        throw new PathTraversalError(relativePath, archivePath);
    }

    return fullPath;
}

//#endregion
