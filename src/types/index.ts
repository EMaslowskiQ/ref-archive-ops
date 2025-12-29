// src/types/index.ts

// Archive types
export {
    CompressionLevel,
    ArchiveOpType,
    ProcessStatus,
} from './archive.types.js';

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
} from './archive.types.js';

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
    exitCodeToErrorCode,
    createErrorFromExitCode,
    parseStderrForError,
} from './errors.types.js';
