// src/core/archiveService.ts
import { randomUUID } from 'crypto';
import { ArchiveOps } from './archiveOps.js';
import {
    type ArchiveServiceConfig,
    type ArchiveOpResult,
    type JobHandle,
    type DecompressOptions,
    type CompressOptions,
    ProcessStatus,
    CompressionLevel,
} from '../types/archive.types.js';

//#region TYPES

/** Internal representation of a queued job */
interface QueuedJob {
    id: string;
    status: ProcessStatus;
    operation: () => Promise<ArchiveOpResult>;
    resolve: (result: ArchiveOpResult) => void;
    reject: (error: Error) => void;
    worker: ArchiveOps | null;
}

//#endregion

/**
 * ArchiveService: Singleton manager for archive operations.
 * Manages a job queue with configurable concurrency limits.
 */
export class ArchiveService {
    //#region PROPERTIES

    private static instance: ArchiveService | null = null;
    private readonly config: ArchiveServiceConfig;
    private readonly queue: Map<string, QueuedJob> = new Map();
    private activeJobs: number = 0;

    //#endregion

    //#region CONSTRUCTOR & SINGLETON

    private constructor(config: ArchiveServiceConfig) {
        this.config = config;
    }

    /**
     * Gets or creates the singleton instance.
     * Config is required on first call, optional on subsequent calls.
     */
    public static getInstance(config?: ArchiveServiceConfig): ArchiveService {
        if (!ArchiveService.instance) {
            if (!config) {
                throw new Error('ArchiveService requires config on first initialization');
            }
            ArchiveService.instance = new ArchiveService(config);
        }
        return ArchiveService.instance;
    }

    /**
     * Destroys the singleton instance and cancels all jobs.
     */
    public static destroy(): void {
        if (ArchiveService.instance) {
            ArchiveService.instance.cancelAll();
            ArchiveService.instance = null;
        }
    }

    /**
     * Checks if the singleton instance exists.
     */
    public static hasInstance(): boolean {
        return ArchiveService.instance !== null;
    }

    //#endregion

    //#region PUBLIC API - SUBMIT METHODS

    /**
     * Submits a decompress job to the queue.
     */
    public submitDecompress(
        archivePath: string,
        destPath: string,
        options?: DecompressOptions
    ): JobHandle {
        return this.submitJob(() => {
            const worker = this.createWorker();
            return worker.decompress(archivePath, destPath, options?.fileList, options?.onProgress);
        });
    }

    /**
     * Submits a compress job to the queue.
     */
    public submitCompress(
        sourceFiles: string[],
        archivePath: string,
        options?: CompressOptions
    ): JobHandle {
        return this.submitJob(() => {
            const worker = this.createWorker();
            return worker.compress(sourceFiles, archivePath, options?.level ?? CompressionLevel.FAST, options?.onProgress);
        });
    }

    /**
     * Submits a list job to the queue.
     */
    public submitList(archivePath: string): JobHandle {
        return this.submitJob(() => {
            const worker = this.createWorker();
            return worker.listEntries(archivePath);
        });
    }

    /**
     * Submits a single-file extraction job to the queue.
     */
    public submitExtractSingle(
        archivePath: string,
        entryPath: string,
        destPath: string
    ): JobHandle {
        return this.submitJob(() => {
            const worker = this.createWorker();
            return worker.extractSingle(archivePath, entryPath, destPath);
        });
    }

    /**
     * Submits an update job to the queue.
     */
    public submitUpdate(
        archivePath: string,
        sourceFiles: string[]
    ): JobHandle {
        return this.submitJob(() => {
            const worker = this.createWorker();
            return worker.update(archivePath, sourceFiles);
        });
    }

    //#endregion

    //#region PUBLIC API - QUEUE MANAGEMENT

    /**
     * Returns current queue status metrics.
     */
    public getStatus(): { active: number; queued: number; total: number } {
        let queued = 0;
        for (const job of this.queue.values()) {
            if (job.status === ProcessStatus.QUEUED) {
                queued++;
            }
        }
        return {
            active: this.activeJobs,
            queued,
            total: this.queue.size,
        };
    }

    /**
     * Cancels a specific job by ID.
     * Returns true if job was found and cancelled.
     */
    public cancelJob(jobId: string): boolean {
        const job = this.queue.get(jobId);
        if (!job) {
            return false;
        }

        // If running, cancel the worker
        if (job.worker && job.status === ProcessStatus.RUNNING) {
            job.worker.cancel();
            this.activeJobs--;
        }

        // Reject the promise
        job.status = ProcessStatus.ERROR;
        job.reject(new Error('Job cancelled'));

        // Remove from queue
        this.queue.delete(jobId);

        // Process next job
        this.processQueue();

        return true;
    }

    /**
     * Cancels all pending and running jobs.
     */
    public cancelAll(): void {
        for (const [jobId, job] of this.queue) {
            if (job.worker && job.status === ProcessStatus.RUNNING) {
                job.worker.cancel();
            }
            job.status = ProcessStatus.ERROR;
            job.reject(new Error('All jobs cancelled'));
        }

        this.queue.clear();
        this.activeJobs = 0;
    }

    /**
     * Returns the job handle for a specific job ID.
     */
    public getJob(jobId: string): JobHandle | null {
        const job = this.queue.get(jobId);
        if (!job) {
            return null;
        }

        return {
            jobId: job.id,
            status: job.status,
            promise: new Promise((resolve, reject) => {
                // This creates a new promise that follows the original
                const originalResolve = job.resolve;
                const originalReject = job.reject;
                job.resolve = (result) => {
                    originalResolve(result);
                    resolve(result);
                };
                job.reject = (error) => {
                    originalReject(error);
                    reject(error);
                };
            }),
            cancel: () => this.cancelJob(jobId),
        };
    }

    //#endregion

    //#region INTERNAL

    /**
     * Creates a new ArchiveOps worker with the service config.
     */
    private createWorker(): ArchiveOps {
        return new ArchiveOps({ executablePath: this.config.executablePath });
    }

    /**
     * Generates a unique job ID.
     */
    private generateJobId(): string {
        return randomUUID();
    }

    /**
     * Submits a job to the queue and returns a JobHandle.
     */
    private submitJob(operation: () => Promise<ArchiveOpResult>): JobHandle {
        const jobId = this.generateJobId();

        let resolvePromise: (result: ArchiveOpResult) => void;
        let rejectPromise: (error: Error) => void;

        const promise = new Promise<ArchiveOpResult>((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });

        const job: QueuedJob = {
            id: jobId,
            status: ProcessStatus.QUEUED,
            operation,
            resolve: resolvePromise!,
            reject: rejectPromise!,
            worker: null,
        };

        this.queue.set(jobId, job);

        // Try to process immediately
        this.processQueue();

        return {
            jobId,
            status: job.status,
            promise,
            cancel: () => this.cancelJob(jobId),
        };
    }

    /**
     * Processes the queue, starting jobs up to maxConcurrent limit.
     */
    private processQueue(): void {
        // Check if we can start more jobs
        if (this.activeJobs >= this.config.maxConcurrent) {
            return;
        }

        // Find next queued job
        for (const [jobId, job] of this.queue) {
            if (job.status !== ProcessStatus.QUEUED) {
                continue;
            }

            // Start this job
            this.activeJobs++;
            job.status = ProcessStatus.RUNNING;

            // Execute the operation
            job.operation()
                .then((result) => {
                    job.status = ProcessStatus.SUCCESS;
                    job.resolve(result);
                    this.cleanupJob(jobId);
                })
                .catch((error) => {
                    job.status = ProcessStatus.ERROR;
                    job.reject(error instanceof Error ? error : new Error(String(error)));
                    this.cleanupJob(jobId);
                });

            // Check if we can start more jobs
            if (this.activeJobs >= this.config.maxConcurrent) {
                return;
            }
        }
    }

    /**
     * Cleans up after a job completes.
     */
    private cleanupJob(jobId: string): void {
        this.queue.delete(jobId);
        this.activeJobs--;

        // Process next job in queue
        this.processQueue();
    }

    //#endregion
}
