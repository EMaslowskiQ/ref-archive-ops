// src/types/errors.types.ts

//#region ERROR CODES

/** Error codes for archive operations */
export enum ArchiveErrorCode {
    // Validation errors
    INVALID_PATH = 'INVALID_PATH',
    PATH_TRAVERSAL = 'PATH_TRAVERSAL',
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    DIRECTORY_NOT_FOUND = 'DIRECTORY_NOT_FOUND',

    // Archive errors
    ENCRYPTED_ARCHIVE = 'ENCRYPTED_ARCHIVE',
    CORRUPT_ARCHIVE = 'CORRUPT_ARCHIVE',
    UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',
    EMPTY_ARCHIVE = 'EMPTY_ARCHIVE',

    // Process errors
    EXECUTABLE_NOT_FOUND = 'EXECUTABLE_NOT_FOUND',
    SPAWN_FAILED = 'SPAWN_FAILED',
    PROCESS_TIMEOUT = 'PROCESS_TIMEOUT',

    // Operation errors
    OPERATION_IN_PROGRESS = 'OPERATION_IN_PROGRESS',
    OPERATION_CANCELLED = 'OPERATION_CANCELLED',

    // I/O errors
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    DISK_FULL = 'DISK_FULL',
    FILE_IN_USE = 'FILE_IN_USE',

    // 7za exit codes
    WARNING = 'WARNING',                       // Exit code 1
    FATAL_ERROR = 'FATAL_ERROR',               // Exit code 2
    COMMAND_LINE_ERROR = 'COMMAND_LINE_ERROR', // Exit code 7
    OUT_OF_MEMORY = 'OUT_OF_MEMORY',           // Exit code 8
    USER_ABORTED = 'USER_ABORTED',             // Exit code 255
}

//#endregion

//#region BASE ERROR

/** Base error class for archive operations */
export class ArchiveError extends Error {
    public readonly code: ArchiveErrorCode;
    public readonly details?: Record<string, unknown>;

    constructor(
        message: string,
        code: ArchiveErrorCode,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'ArchiveError';
        this.code = code;
        this.details = details;

        // Maintains proper stack trace for where error was thrown (V8 only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ArchiveError);
        }
    }
}

//#endregion

//#region SPECIFIC ERRORS

/** Error thrown when an encrypted archive is detected */
export class EncryptedArchiveError extends ArchiveError {
    constructor(archivePath: string) {
        super(
            `Archive is encrypted and cannot be processed: ${archivePath}`,
            ArchiveErrorCode.ENCRYPTED_ARCHIVE,
            { archivePath }
        );
        this.name = 'EncryptedArchiveError';
    }
}

/** Error thrown when path traversal attack is detected */
export class PathTraversalError extends ArchiveError {
    constructor(maliciousPath: string, archivePath: string) {
        super(
            `Path traversal detected in archive entry: ${maliciousPath}`,
            ArchiveErrorCode.PATH_TRAVERSAL,
            { maliciousPath, archivePath }
        );
        this.name = 'PathTraversalError';
    }
}

/** Error thrown when 7za executable is not found */
export class ExecutableNotFoundError extends ArchiveError {
    constructor(executablePath: string) {
        super(
            `7za executable not found at: ${executablePath}`,
            ArchiveErrorCode.EXECUTABLE_NOT_FOUND,
            { executablePath }
        );
        this.name = 'ExecutableNotFoundError';
    }
}

/** Error thrown when archive format is not supported */
export class UnsupportedFormatError extends ArchiveError {
    constructor(archivePath: string, extension: string) {
        super(
            `Unsupported archive format: ${extension}. Only .zip is supported.`,
            ArchiveErrorCode.UNSUPPORTED_FORMAT,
            { archivePath, extension }
        );
        this.name = 'UnsupportedFormatError';
    }
}

/** Error thrown when an operation is already in progress */
export class OperationInProgressError extends ArchiveError {
    constructor(currentOperation: string) {
        super(
            `Cannot start new operation. A ${currentOperation} operation is already running.`,
            ArchiveErrorCode.OPERATION_IN_PROGRESS,
            { currentOperation }
        );
        this.name = 'OperationInProgressError';
    }
}

/** Error thrown when archive is corrupted */
export class CorruptArchiveError extends ArchiveError {
    constructor(archivePath: string, details?: string) {
        super(
            `Archive is corrupted: ${archivePath}${details ? ` (${details})` : ''}`,
            ArchiveErrorCode.CORRUPT_ARCHIVE,
            { archivePath, details }
        );
        this.name = 'CorruptArchiveError';
    }
}

//#endregion

//#region UTILITIES

/** Known 7za stderr patterns mapped to error codes and messages */
interface StderrPattern {
    pattern: RegExp;
    code: ArchiveErrorCode;
    message: string;
}

const STDERR_PATTERNS: StderrPattern[] = [
    // Corruption errors
    { pattern: /CRC Failed/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'CRC check failed - archive is corrupted' },
    { pattern: /Data Error/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'Data error - archive is corrupted' },
    { pattern: /Headers Error/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'Invalid archive headers - archive is corrupted' },
    { pattern: /Unexpected end of archive/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'Unexpected end of archive - file may be truncated' },
    { pattern: /Can not open the file as archive/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'Cannot open file as archive - invalid or corrupted' },
    { pattern: /Is not archive/i, code: ArchiveErrorCode.CORRUPT_ARCHIVE, message: 'File is not a valid archive' },

    // Permission errors
    { pattern: /Access is denied/i, code: ArchiveErrorCode.PERMISSION_DENIED, message: 'Access denied - permission error' },
    { pattern: /cannot access the file because it is being used/i, code: ArchiveErrorCode.FILE_IN_USE, message: 'File is in use by another process' },
    { pattern: /Sharing violation/i, code: ArchiveErrorCode.FILE_IN_USE, message: 'Sharing violation - file is locked' },

    // Disk errors
    { pattern: /There is not enough space on the disk/i, code: ArchiveErrorCode.DISK_FULL, message: 'Not enough disk space' },
    { pattern: /No space left on device/i, code: ArchiveErrorCode.DISK_FULL, message: 'No space left on device' },

    // File errors
    { pattern: /Cannot find the file/i, code: ArchiveErrorCode.FILE_NOT_FOUND, message: 'File not found' },
    { pattern: /The system cannot find the file/i, code: ArchiveErrorCode.FILE_NOT_FOUND, message: 'System cannot find the file' },
    { pattern: /The system cannot find the path/i, code: ArchiveErrorCode.DIRECTORY_NOT_FOUND, message: 'System cannot find the path' },

    // Encryption errors
    { pattern: /Wrong password/i, code: ArchiveErrorCode.ENCRYPTED_ARCHIVE, message: 'Wrong password for encrypted archive' },
    { pattern: /Enter password/i, code: ArchiveErrorCode.ENCRYPTED_ARCHIVE, message: 'Archive requires a password' },
];

/** Maps 7za exit codes to ArchiveErrorCode */
export function exitCodeToErrorCode(exitCode: number): ArchiveErrorCode | null {
    switch (exitCode) {
        case 0:
            return null; // Success
        case 1:
            return ArchiveErrorCode.WARNING;
        case 2:
            return ArchiveErrorCode.FATAL_ERROR;
        case 7:
            return ArchiveErrorCode.COMMAND_LINE_ERROR;
        case 8:
            return ArchiveErrorCode.OUT_OF_MEMORY;
        case 255:
            return ArchiveErrorCode.USER_ABORTED;
        default:
            return ArchiveErrorCode.FATAL_ERROR;
    }
}

/** Default messages for each error code */
const DEFAULT_MESSAGES: Record<ArchiveErrorCode, string> = {
    [ArchiveErrorCode.WARNING]: 'Operation completed with warnings',
    [ArchiveErrorCode.FATAL_ERROR]: 'Fatal error occurred during operation',
    [ArchiveErrorCode.COMMAND_LINE_ERROR]: 'Invalid command line arguments',
    [ArchiveErrorCode.OUT_OF_MEMORY]: 'Out of memory',
    [ArchiveErrorCode.USER_ABORTED]: 'Operation was aborted',
    [ArchiveErrorCode.INVALID_PATH]: 'Invalid path',
    [ArchiveErrorCode.PATH_TRAVERSAL]: 'Path traversal detected',
    [ArchiveErrorCode.FILE_NOT_FOUND]: 'File not found',
    [ArchiveErrorCode.DIRECTORY_NOT_FOUND]: 'Directory not found',
    [ArchiveErrorCode.ENCRYPTED_ARCHIVE]: 'Archive is encrypted',
    [ArchiveErrorCode.CORRUPT_ARCHIVE]: 'Archive is corrupted',
    [ArchiveErrorCode.UNSUPPORTED_FORMAT]: 'Unsupported format',
    [ArchiveErrorCode.EMPTY_ARCHIVE]: 'Archive is empty',
    [ArchiveErrorCode.EXECUTABLE_NOT_FOUND]: 'Executable not found',
    [ArchiveErrorCode.SPAWN_FAILED]: 'Failed to spawn process',
    [ArchiveErrorCode.PROCESS_TIMEOUT]: 'Process timed out',
    [ArchiveErrorCode.OPERATION_IN_PROGRESS]: 'Operation in progress',
    [ArchiveErrorCode.OPERATION_CANCELLED]: 'Operation cancelled',
    [ArchiveErrorCode.PERMISSION_DENIED]: 'Permission denied',
    [ArchiveErrorCode.DISK_FULL]: 'Disk is full',
    [ArchiveErrorCode.FILE_IN_USE]: 'File is in use',
};

/**
 * Parses stderr output for known 7za error patterns.
 * Returns matched pattern or null if no match found.
 */
export function parseStderrForError(stderr: string): { code: ArchiveErrorCode; message: string } | null {
    for (const { pattern, code, message } of STDERR_PATTERNS) {
        if (pattern.test(stderr)) {
            return { code, message };
        }
    }
    return null;
}

/**
 * Creates appropriate ArchiveError from 7za exit code and stderr output.
 * Stderr is parsed first for specific error messages, then falls back to exit code.
 */
export function createErrorFromExitCode(
    exitCode: number,
    archivePath: string,
    stderr: string = ''
): ArchiveError {
    // First, try to parse stderr for a specific error
    const stderrError = parseStderrForError(stderr);
    if (stderrError) {
        return new ArchiveError(
            stderrError.message,
            stderrError.code,
            { archivePath, exitCode, stderr: stderr.trim() }
        );
    }

    // Fall back to exit code mapping
    const errorCode = exitCodeToErrorCode(exitCode) ?? ArchiveErrorCode.FATAL_ERROR;
    let message = DEFAULT_MESSAGES[errorCode];

    // If we have stderr content but no pattern matched, append it to the message
    const stderrTrimmed = stderr.trim();
    if (stderrTrimmed && stderrTrimmed.length < 200) {
        message = `${message}: ${stderrTrimmed}`;
    }

    return new ArchiveError(
        message,
        errorCode,
        { archivePath, exitCode, stderr: stderrTrimmed || undefined }
    );
}

//#endregion
