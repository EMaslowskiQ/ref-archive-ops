// src/core/archiveOps.ts
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'child_process';
import { promises as fs, statSync } from 'fs';
import path from 'path';

import {
    type ArchiveOpsConfig,
    type ArchiveOpResult,
    type FileInfo,
    type ProgressCallback,
    ArchiveOpType,
    ProcessStatus,
    CompressionLevel,
} from '../types/archive.types.js';

import {
    ArchiveError,
    ArchiveErrorCode,
    EncryptedArchiveError,
    ExecutableNotFoundError,
    UnsupportedFormatError,
    OperationInProgressError,
    createErrorFromExitCode,
} from '../types/errors.types.js';

import { validateAllEntries, normalizePath } from '../utils/pathValidation.js';
import { parseSltString, hasEncryptedFiles } from '../utils/sltParser.js';


/**
 * ArchiveOps: Worker class for archive operations via 7za CLI.
 * Each instance handles one operation at a time. Create new instances for concurrent operations.
 */
export class ArchiveOps {
    //#region PROPERTIES

    private readonly config: ArchiveOpsConfig;
    private status: ProcessStatus = ProcessStatus.UNDEFINED;
    private lastMessage: string = '';
    private process: ChildProcessWithoutNullStreams | null = null;
    private activeOp: ArchiveOpType = ArchiveOpType.UNDEFINED;
    private startTime: number = 0;
    private currentArchivePath: string = '';

    //#endregion

    //#region CONSTRUCTOR

    constructor(config: ArchiveOpsConfig) {
        this.config = config;
    }

    //#endregion

    //#region PUBLIC API

    /**
     * Lists all entries in an archive using -slt format for reliable parsing.
     * Detects encrypted archives and throws EncryptedArchiveError.
     */
    public async listEntries(archivePath: string): Promise<ArchiveOpResult> {
        this.lastMessage = '';
        this.currentArchivePath = archivePath;

        // Verify no operation is in progress
        if (this.activeOp !== ArchiveOpType.UNDEFINED) {
            throw new OperationInProgressError(ArchiveOpType[this.activeOp]);
        }

        // Validate archive path
        const fullArchivePath = path.resolve(archivePath);
        await this.verifyArchive(fullArchivePath);

        // Update state
        this.activeOp = ArchiveOpType.LIST;
        this.status = ProcessStatus.RUNNING;
        this.lastMessage = 'Listing archive contents...';
        this.startTime = Date.now();

        return new Promise((resolve, reject) => {
            try {
                // 7za args: l=list, -slt=technical listing format
                const args = ['l', '-slt', fullArchivePath];
                let stderrBuffer = '';

                this.process = this.spawnProcess(args);
                let stdoutBuffer = '';

                this.process.stdout.on('data', (data: Buffer) => {
                    if (this.status <= 0) return;
                    stdoutBuffer += data.toString();
                });

                this.process.stderr.on('data', (data: Buffer) => {
                    stderrBuffer += data.toString();
                });

                this.process.on('error', (error: Error) => {
                    reject(this.createSpawnError(error));
                });

                this.process.on('close', (code: number | null) => {
                    const exitCode = code ?? 0;

                    // Exit code 0 = success
                    if (exitCode === 0) {
                        const files = parseSltString(stdoutBuffer);

                        // Check for encrypted files
                        if (hasEncryptedFiles(files)) {
                            this.cleanup();
                            reject(new EncryptedArchiveError(fullArchivePath));
                            return;
                        }

                        resolve(this.createSuccessResult(
                            `Listed ${files.length} entries in '${path.basename(archivePath)}'.`,
                            files,
                            fullArchivePath,
                            exitCode
                        ));
                    } else {
                        this.cleanup();
                        reject(createErrorFromExitCode(exitCode, fullArchivePath, stderrBuffer));
                    }
                });

            } catch (error) {
                this.cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Extracts archive contents to target directory.
     * Validates paths for traversal attacks before extraction.
     */
    public async decompress(
        archivePath: string,
        targetPath: string,
        fileList?: string[],
        onProgress?: ProgressCallback
    ): Promise<ArchiveOpResult> {
        this.lastMessage = '';
        this.currentArchivePath = archivePath;

        // Verify no operation is in progress
        if (this.activeOp !== ArchiveOpType.UNDEFINED) {
            throw new OperationInProgressError(ArchiveOpType[this.activeOp]);
        }

        // Resolve paths
        const fullArchivePath = path.resolve(archivePath);
        const fullTargetPath = path.resolve(targetPath);
        const srcFilename = path.basename(fullArchivePath);

        // Validate archive
        await this.verifyArchive(fullArchivePath);

        // Ensure target directory exists
        await this.ensureDirectoryExists(fullTargetPath);

        // Get file list and validate paths BEFORE extraction
        const listResult = await this.listEntriesInternal(fullArchivePath);
        if (listResult.files.length === 0) {
            throw new ArchiveError(
                `Cannot decompress empty archive: ${srcFilename}`,
                ArchiveErrorCode.EMPTY_ARCHIVE,
                { archivePath: fullArchivePath }
            );
        }

        // Security: validate all entry paths for traversal attacks
        validateAllEntries(listResult.files, fullArchivePath);

        // Reset state for decompress operation
        this.activeOp = ArchiveOpType.DECOMPRESS;
        this.status = ProcessStatus.RUNNING;
        this.lastMessage = `Extracting '${srcFilename}' to '${targetPath}'`;
        this.startTime = Date.now();

        return new Promise((resolve, reject) => {
            try {
                let progress = 0;
                let stderrBuffer = '';

                // 7za args: x=extract with paths, -aoa=overwrite all, -bsp1=progress to stdout
                const args = ['x', '-aoa', '-bsp1', '-bso0', fullArchivePath, `-o${fullTargetPath}`];

                // Add specific files if provided
                if (fileList && fileList.length > 0) {
                    args.push(...fileList);
                }

                this.process = this.spawnProcess(args);

                this.process.stdout.on('data', (data: Buffer) => {
                    if (this.status <= 0) return;

                    const message = data.toString();
                    const progressMatch = message.match(/(\d+)%/);
                    if (progressMatch) {
                        progress = parseInt(progressMatch[1], 10);
                    }

                    const newMessage = `Extracting '${srcFilename}'...${progress}%`;
                    if (newMessage !== this.lastMessage) {
                        this.lastMessage = newMessage;
                        onProgress?.(progress, this.lastMessage);
                    }
                });

                this.process.stderr.on('data', (data: Buffer) => {
                    stderrBuffer += data.toString();
                });

                this.process.on('error', (error: Error) => {
                    reject(this.createSpawnError(error));
                });

                this.process.on('close', (code: number | null) => {
                    const exitCode = code ?? 0;

                    if (exitCode === 0) {
                        onProgress?.(100, `Extracted '${srcFilename}'.`);
                        resolve(this.createSuccessResult(
                            `Extracted '${srcFilename}' to '${targetPath}'.`,
                            listResult.files,
                            fullTargetPath,
                            exitCode
                        ));
                    } else {
                        this.cleanup();
                        reject(createErrorFromExitCode(exitCode, fullArchivePath, stderrBuffer));
                    }
                });

            } catch (error) {
                this.cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Creates a ZIP archive from source files.
     */
    public async compress(
        sourceFiles: string[],
        archivePath: string,
        level: CompressionLevel = CompressionLevel.FAST,
        onProgress?: ProgressCallback
    ): Promise<ArchiveOpResult> {
        this.lastMessage = '';

        // Verify no operation is in progress
        if (this.activeOp !== ArchiveOpType.UNDEFINED) {
            throw new OperationInProgressError(ArchiveOpType[this.activeOp]);
        }

        // Resolve paths
        const fullArchivePath = path.resolve(archivePath);
        const resolvedSourceFiles = sourceFiles.map(f => path.resolve(f));
        const archiveFilename = path.basename(fullArchivePath);

        // Verify archive has .zip extension
        const ext = path.extname(fullArchivePath).toLowerCase();
        if (ext !== '.zip') {
            throw new UnsupportedFormatError(fullArchivePath, ext || '(none)');
        }

        // Verify all source files exist
        const missingFiles: string[] = [];
        for (const file of resolvedSourceFiles) {
            if (!(await this.canAccessFile(file))) {
                missingFiles.push(path.basename(file));
            }
        }
        if (missingFiles.length > 0) {
            throw new ArchiveError(
                `Source files not found: ${missingFiles.join(', ')}`,
                ArchiveErrorCode.FILE_NOT_FOUND,
                { missingFiles }
            );
        }

        // Ensure target directory exists
        const targetDir = path.dirname(fullArchivePath);
        await this.ensureDirectoryExists(targetDir);

        // Check if overwriting
        if (await this.canAccessFile(fullArchivePath)) {
            onProgress?.(0, `Overwriting existing archive: ${archiveFilename}`);
        }

        // Update state
        this.activeOp = ArchiveOpType.COMPRESS;
        this.status = ProcessStatus.RUNNING;
        this.lastMessage = `Compressing to '${archiveFilename}'`;
        this.startTime = Date.now();

        return new Promise((resolve, reject) => {
            try {
                let progress = 0;
                let stderrBuffer = '';

                // 7za args: a=add, -tzip=zip format, -mx=compression level, -bsp1=progress
                const args = [
                    'a',
                    '-tzip',
                    `-mx${level}`,
                    '-bsp1',
                    '-bso0',
                    fullArchivePath,
                    ...resolvedSourceFiles
                ];

                this.process = this.spawnProcess(args);

                this.process.stdout.on('data', (data: Buffer) => {
                    if (this.status <= 0) return;

                    const message = data.toString();
                    const progressMatch = message.match(/(\d+)%/);
                    if (progressMatch) {
                        progress = parseInt(progressMatch[1], 10);
                    }

                    const newMessage = `Compressing '${archiveFilename}'...${progress}%`;
                    if (newMessage !== this.lastMessage) {
                        this.lastMessage = newMessage;
                        onProgress?.(progress, this.lastMessage);
                    }
                });

                this.process.stderr.on('data', (data: Buffer) => {
                    stderrBuffer += data.toString();
                });

                this.process.on('error', (error: Error) => {
                    reject(this.createSpawnError(error));
                });

                this.process.on('close', (code: number | null) => {
                    const exitCode = code ?? 0;

                    if (exitCode === 0) {
                        const archiveStats = statSync(fullArchivePath);
                        const archiveInfo: FileInfo = {
                            date: archiveStats.mtime,
                            filename: archiveFilename,
                            size: archiveStats.size,
                        };

                        const sourceDesc = sourceFiles.length > 1
                            ? `${sourceFiles.length} files`
                            : `'${path.basename(sourceFiles[0])}'`;

                        onProgress?.(100, `Compressed ${sourceDesc} to '${archiveFilename}'.`);
                        resolve(this.createSuccessResult(
                            `Compressed ${sourceDesc} to '${archiveFilename}'.`,
                            [archiveInfo],
                            path.dirname(fullArchivePath),
                            exitCode
                        ));
                    } else {
                        this.cleanup();
                        reject(createErrorFromExitCode(exitCode, fullArchivePath, stderrBuffer));
                    }
                });

            } catch (error) {
                this.cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Extracts a single file from an archive.
     */
    public async extractSingle(
        archivePath: string,
        entryPath: string,
        destPath: string
    ): Promise<ArchiveOpResult> {
        // Delegate to decompress with single file
        return this.decompress(archivePath, destPath, [entryPath]);
    }

    /**
     * Adds or updates files in an existing archive.
     */
    public async update(
        archivePath: string,
        sourceFiles: string[]
    ): Promise<ArchiveOpResult> {
        this.lastMessage = '';

        // Verify no operation is in progress
        if (this.activeOp !== ArchiveOpType.UNDEFINED) {
            throw new OperationInProgressError(ArchiveOpType[this.activeOp]);
        }

        // Resolve paths
        const fullArchivePath = path.resolve(archivePath);
        const resolvedSourceFiles = sourceFiles.map(f => path.resolve(f));
        const archiveFilename = path.basename(fullArchivePath);

        // Verify archive exists and is valid
        await this.verifyArchive(fullArchivePath);

        // Verify all source files exist
        const missingFiles: string[] = [];
        for (const file of resolvedSourceFiles) {
            if (!(await this.canAccessFile(file))) {
                missingFiles.push(path.basename(file));
            }
        }
        if (missingFiles.length > 0) {
            throw new ArchiveError(
                `Source files not found: ${missingFiles.join(', ')}`,
                ArchiveErrorCode.FILE_NOT_FOUND,
                { missingFiles }
            );
        }

        // Update state
        this.activeOp = ArchiveOpType.UPDATE;
        this.status = ProcessStatus.RUNNING;
        this.lastMessage = `Updating '${archiveFilename}'`;
        this.startTime = Date.now();

        return new Promise((resolve, reject) => {
            try {
                let stderrBuffer = '';

                // 7za args: u=update, -tzip=zip format
                const args = [
                    'u',
                    '-tzip',
                    '-bsp1',
                    '-bso0',
                    fullArchivePath,
                    ...resolvedSourceFiles
                ];

                this.process = this.spawnProcess(args);

                this.process.stdout.on('data', () => {
                    // Progress parsing for update is similar to compress
                });

                this.process.stderr.on('data', (data: Buffer) => {
                    stderrBuffer += data.toString();
                });

                this.process.on('error', (error: Error) => {
                    reject(this.createSpawnError(error));
                });

                this.process.on('close', (code: number | null) => {
                    const exitCode = code ?? 0;

                    if (exitCode === 0) {
                        const sourceDesc = sourceFiles.length > 1
                            ? `${sourceFiles.length} files`
                            : `'${path.basename(sourceFiles[0])}'`;

                        resolve(this.createSuccessResult(
                            `Updated '${archiveFilename}' with ${sourceDesc}.`,
                            [],
                            path.dirname(fullArchivePath),
                            exitCode
                        ));
                    } else {
                        this.cleanup();
                        reject(createErrorFromExitCode(exitCode, fullArchivePath, stderrBuffer));
                    }
                });

            } catch (error) {
                this.cleanup();
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    /**
     * Validates entry paths for path traversal attacks.
     * Throws PathTraversalError if malicious paths are detected.
     */
    public validateEntryPaths(entries: FileInfo[]): void {
        validateAllEntries(entries, this.currentArchivePath);
    }

    /**
     * Cancels the current operation.
     */
    public cancel(): void {
        if (this.process && !this.process.killed) {
            this.process.kill('SIGTERM');
            this.status = ProcessStatus.ERROR;
            this.lastMessage = 'Operation cancelled';
        }
        this.cleanup();
    }

    /**
     * Returns current operation status.
     */
    public getStatus(): { status: ProcessStatus; message: string } {
        return { status: this.status, message: this.lastMessage };
    }

    //#endregion

    //#region INTERNAL

    /**
     * Internal list operation that doesn't check for active operations.
     * Used by decompress to get file list before extraction.
     */
    private async listEntriesInternal(fullArchivePath: string): Promise<ArchiveOpResult> {
        return new Promise((resolve, reject) => {
            const args = ['l', '-slt', fullArchivePath];
            const proc = this.spawnProcess(args);
            let stdoutBuffer = '';
            let stderrBuffer = '';

            proc.stdout.on('data', (data: Buffer) => {
                stdoutBuffer += data.toString();
            });

            proc.stderr.on('data', (data: Buffer) => {
                stderrBuffer += data.toString();
            });

            proc.on('error', (error: Error) => {
                reject(this.createSpawnError(error));
            });

            proc.on('close', (code: number | null) => {
                const exitCode = code ?? 0;

                if (exitCode === 0) {
                    const files = parseSltString(stdoutBuffer);

                    if (hasEncryptedFiles(files)) {
                        reject(new EncryptedArchiveError(fullArchivePath));
                        return;
                    }

                    resolve({
                        success: true,
                        runtime: 0,
                        type: ArchiveOpType.LIST,
                        message: `Listed ${files.length} entries.`,
                        files,
                        basePath: path.dirname(fullArchivePath),
                        exitCode,
                    });
                } else {
                    reject(createErrorFromExitCode(exitCode, fullArchivePath, stderrBuffer));
                }
            });
        });
    }

    /**
     * Spawns 7za process with shell:false for security.
     */
    private spawnProcess(args: string[]): ChildProcessWithoutNullStreams {
        const options: SpawnOptions = {
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        };

        return spawn(this.config.executablePath, args, options) as ChildProcessWithoutNullStreams;
    }

    /**
     * Verifies archive exists and has supported extension (.zip only).
     */
    private async verifyArchive(archivePath: string): Promise<void> {
        // Check file exists
        try {
            await fs.access(archivePath);
        } catch {
            throw new ArchiveError(
                `Archive not found: ${archivePath}`,
                ArchiveErrorCode.FILE_NOT_FOUND,
                { archivePath }
            );
        }

        // Check extension (ZIP only)
        const ext = path.extname(archivePath).toLowerCase();
        if (ext !== '.zip') {
            throw new UnsupportedFormatError(archivePath, ext || '(none)');
        }
    }

    /**
     * Ensures directory exists, creating it if necessary.
     */
    private async ensureDirectoryExists(directoryPath: string): Promise<void> {
        try {
            await fs.access(directoryPath);
        } catch {
            try {
                await fs.mkdir(directoryPath, { recursive: true });
            } catch (mkdirError) {
                throw new ArchiveError(
                    `Failed to create directory: ${directoryPath}`,
                    ArchiveErrorCode.DIRECTORY_NOT_FOUND,
                    { directoryPath, error: String(mkdirError) }
                );
            }
        }
    }

    /**
     * Checks if a file is accessible.
     */
    private async canAccessFile(fullPath: string): Promise<boolean> {
        try {
            await fs.access(fullPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Creates error for spawn failures.
     */
    private createSpawnError(error: Error): ArchiveError {
        if (error.message.includes('ENOENT')) {
            return new ExecutableNotFoundError(this.config.executablePath);
        }
        return new ArchiveError(
            `Failed to spawn 7za: ${error.message}`,
            ArchiveErrorCode.SPAWN_FAILED,
            { originalError: error.message }
        );
    }

    /**
     * Creates successful result object.
     */
    private createSuccessResult(
        message: string,
        files: FileInfo[],
        basePath: string,
        exitCode: number
    ): ArchiveOpResult {
        const runtime = (Date.now() - this.startTime) / 1000;

        this.status = ProcessStatus.SUCCESS;
        this.lastMessage = message;
        this.cleanup();

        return {
            success: true,
            runtime,
            type: this.activeOp,
            message,
            files,
            basePath: normalizePath(basePath),
            exitCode,
        };
    }

    /**
     * Cleans up after operation completes.
     */
    private cleanup(): void {
        this.activeOp = ArchiveOpType.UNDEFINED;

        if (this.process && !this.process.killed) {
            this.process.kill();
            this.process = null;
        }
    }

    //#endregion
}
