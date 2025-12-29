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

/** Creates appropriate ArchiveError from 7za exit code */
export function createErrorFromExitCode(exitCode: number, archivePath: string): ArchiveError {
    const errorCode = exitCodeToErrorCode(exitCode) ?? ArchiveErrorCode.FATAL_ERROR;
    const messages: Record<ArchiveErrorCode, string> = {
        [ArchiveErrorCode.WARNING]: 'Operation completed with warnings',
        [ArchiveErrorCode.FATAL_ERROR]: 'Fatal error occurred during operation',
        [ArchiveErrorCode.COMMAND_LINE_ERROR]: 'Invalid command line arguments',
        [ArchiveErrorCode.OUT_OF_MEMORY]: 'Out of memory',
        [ArchiveErrorCode.USER_ABORTED]: 'Operation was aborted',
        // Provide defaults for other codes
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
    };

    return new ArchiveError(
        messages[errorCode],
        errorCode,
        { archivePath, exitCode }
    );
}

//#endregion
