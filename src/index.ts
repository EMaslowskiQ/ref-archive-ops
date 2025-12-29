// src/index.ts

// Core classes
export { ArchiveOps } from './core/archiveOps.js';

// Types - enums
export {
    CompressionLevel,
    ArchiveOpType,
    ProcessStatus,
} from './types/archive.types.js';

// Types - interfaces
export type {
    FileInfo,
    ArchiveOpResult,
    ProgressCallback,
    EndCallback,
    ArchiveOpsConfig,
    ArchiveServiceConfig,
    DecompressOptions,
    CompressOptions,
    JobHandle,
} from './types/archive.types.js';

// Error types
export {
    ArchiveErrorCode,
    ArchiveError,
    EncryptedArchiveError,
    PathTraversalError,
    ExecutableNotFoundError,
    UnsupportedFormatError,
    OperationInProgressError,
    CorruptArchiveError,
} from './types/errors.types.js';

// Utilities (for advanced users)
export {
    validateEntryPath,
    validateAllEntries,
    normalizePath,
    isSafePath,
    resolveExtractPath,
} from './utils/pathValidation.js';

export {
    parseSltOutput,
    parseSltString,
    hasEncryptedFiles,
    findEncryptedFile,
} from './utils/sltParser.js';
