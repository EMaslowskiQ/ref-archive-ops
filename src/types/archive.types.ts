// src/types/archive.types.ts

//#region TYPES

/** Compression levels mapped to 7za -mx parameter */
export enum CompressionLevel {
    STORE = 0,      // -mx0 (no compression, copy only)
    FAST = 1,       // -mx1 (fastest)
    NORMAL = 5,     // -mx5 (balanced)
}

/** Archive operation types */
export enum ArchiveOpType {
    UNDEFINED = 0,
    COMPRESS = 1,
    DECOMPRESS = 2,
    LIST = 3,
    EXTRACT_SINGLE = 4,
    UPDATE = 5,
}

/** Process status for internal state tracking */
export enum ProcessStatus {
    UNDEFINED = -1,
    ERROR = 0,
    SUCCESS = 1,
    PENDING = 2,    // Validated, waiting to start
    QUEUED = 10,    // In service queue
    RUNNING = 11,
}

/** File metadata from archive listing */
export interface FileInfo {
    /** File modification date */
    date: Date;
    /** Uncompressed file size in bytes */
    size: number;
    /** Compressed size in bytes (from -slt output) */
    compressedSize?: number;
    /** Relative path within archive (e.g., "masks/image_01.jpg") */
    filename: string;
    /** Whether the file is encrypted */
    encrypted?: boolean;
    /** CRC checksum (from -slt output) */
    crc?: string;
}

/** Result returned by all ArchiveOps operations */
export interface ArchiveOpResult {
    /** Whether the operation succeeded */
    success: boolean;
    /** Operation duration in seconds */
    runtime: number;
    /** Type of operation performed */
    type: ArchiveOpType;
    /** Human-readable status or error message */
    message: string;
    /** List of files processed */
    files: FileInfo[];
    /** Base directory for path reconstruction (e.g., extraction target) */
    basePath?: string;
    /** 7za exit code for diagnostics */
    exitCode?: number;
}

//#endregion

//#region CALLBACKS

/** Progress callback for long-running operations */
export type ProgressCallback = (progress: number | null, message: string) => void;

/** Completion callback */
export type EndCallback = (result: ArchiveOpResult) => void;

//#endregion

//#region CONFIGURATION

/** Configuration for ArchiveOps worker */
export interface ArchiveOpsConfig {
    /** Absolute path to 7za executable */
    executablePath: string;
}

/** Configuration for ArchiveService manager */
export interface ArchiveServiceConfig {
    /** Absolute path to 7za executable (passed to workers) */
    executablePath: string;
    /** Maximum concurrent operations (1 for HDD, 2+ for NVMe) */
    maxConcurrent: number;
}

/** Options for decompress operation */
export interface DecompressOptions {
    /** Specific files to extract (extracts all if not provided) */
    fileList?: string[];
}

/** Options for compress operation */
export interface CompressOptions {
    /** Compression level (defaults to FAST) */
    level?: CompressionLevel;
}

//#endregion

//#region JOB HANDLE

/** Handle returned by ArchiveService submit methods */
export interface JobHandle {
    /** Unique job identifier */
    jobId: string;
    /** Current job status */
    status: ProcessStatus;
    /** Promise that resolves when job completes */
    promise: Promise<ArchiveOpResult>;
    /** Cancel this job */
    cancel: () => void;
}

//#endregion
