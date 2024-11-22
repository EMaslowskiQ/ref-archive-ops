import { spawn, ChildProcessWithoutNullStreams, CommonSpawnOptions } from 'child_process';
import { promises as fs, statSync } from 'fs';
import path from 'path';

export enum ProcessStatus {
    UNDEFINED = -1,
    ERROR = 0,
    SUCCESS = 1,
    PENDING = 2,
    PAUSED = 10,
    RUNNING = 11,
};
export enum ArchiveOpType {
    UNDEFINED,
	COMPRESS,
	DECOMPRESS,
    LIST,
	// APPEND,
	// REMOVE,
};
export type ArchiveOpResult = {
    success: boolean,
    runtime: number,
	type: ArchiveOpType,
	message: string,
    files: FileInfo[],
};

type FileInfo = {
    date: Date;
    size: number;
    filename: string;
}

type ProgressCallback = (progress: number | null, message: string) => void;
type EndCallback = (result: ArchiveOpResult) =>  void;

/**
 * ArchiveOp: Wrapper for 7-zip. Spawns a child process and intercepts stdio to
 * monitor progress and handle errors.
 */
export class ArchiveOps {
    status: ProcessStatus = ProcessStatus.UNDEFINED;
    lastMessage: string = '';
    process: ChildProcessWithoutNullStreams | null = null;
    private activeOp: ArchiveOpType = ArchiveOpType.UNDEFINED;
    private startTime: number = 0;

    async decompress(archivePath: string, targetPath: string, onProgress?: ProgressCallback | null, onEnd?: EndCallback | null ): Promise<ArchiveOpResult>  {
        let progress: number = 0;
        this.lastMessage = '';

        // clean our paths
        archivePath = this.cleanPath(archivePath);
        targetPath = this.cleanPath(targetPath);

        // make sure our operation matches how we were created
        if(this.activeOp !== ArchiveOpType.UNDEFINED)
            return this.getResult(false, `Cannot decompress '${archivePath}'. A ${ArchiveOpType[this.activeOp]} operation is already running.`, ArchiveOpType.DECOMPRESS);

        // signal that we're about to do work
        this.status = ProcessStatus.PENDING;
        this.lastMessage = 'Verifying parameters for archive operation';

        // create our external process using 'spawn' so we can get the stdio/progress
        // using 'resolve' for all returns since our return object holds if an error is present or not
        return new Promise(async (resolve)=> {
            try {
                // make sure we have absolute paths
                const fullArchivePath: string = this.cleanPath(path.resolve(archivePath));
                const fullTargetPath: string = this.cleanPath(path.resolve(targetPath));

                // verify our archive path
                const srcFilename: string = path.basename(fullArchivePath);
                const {success: srcSuccess, message: srcMessage} = await this.verifyArchive(fullArchivePath);
                if(srcSuccess===false)
                    resolve(this.handleError(srcMessage, onProgress, onEnd));
                
                // verify our target path
                const {success: dstSuccess, message: dstMessage} = await this.ensureDirectoryExists(fullTargetPath);
                if(dstSuccess===false)
                    resolve(this.handleError(dstMessage, onProgress, onEnd));                

                // we have an archive so get the list of files for use later
                // and check if we have files to process.
                const listResult:ArchiveOpResult = await this.listEntries(fullArchivePath);
                if(!listResult.success)
                    resolve(this.handleError(`cannot get archive contents: ${listResult.message}`, onProgress, onEnd));
                if(!listResult.files || listResult.files.length===0)
                    resolve(this.handleError(`cannot decompress an empty archive. (${srcFilename})`, onProgress, onEnd));

                // update status and state
                progress = 0;
                this.lastMessage = '';
                this.activeOp = ArchiveOpType.DECOMPRESS;
                this.status = ProcessStatus.RUNNING;
                this.lastMessage = `Unpacking '${srcFilename}' to '${targetPath}'`;
                this.startTime = Date.now();
           
                // set 7-zip switches
                // bsp1: redireect progress to stdout
                // bso0: disable standard messages
                // bse1: send errors to stdout too to avoid default printing of stacktrace (optional)
                const command = '7z';                
                const args = ['x', '-bsp1', '-bso0', fullArchivePath, `-o${fullTargetPath}`];

                // set child_process 'spawn' options handling where to send stdio messages
                // stdin: ignore | stdout: pipe | stderr: pipe
                const options: CommonSpawnOptions = { shell:true , stdio: ['pipe','pipe','pipe'] };
                this.process = spawn(command, args, options)  as ChildProcessWithoutNullStreams;
            
                // handle our progress updates
                this.process.stdout.on('data', (data: Buffer) => {

                    // if we're in an invalid state just return
                    if(this.status <= 0)
                        return; 

                    const message = data.toString();
                    const progressMatch = message.match(/(\d+)%/);
                    if (progressMatch) {
                        progress = parseInt(progressMatch[1], 10);
                    }

                    // avoid duplicate updates and messages
                    const newMessage = `decompressing '${srcFilename}'...${progress}%`;
                    if(newMessage!=this.lastMessage) {
                        this.lastMessage = newMessage;
                        onProgress?.(progress, this.lastMessage);
                    }
                });

                // handle stdio errors from the process
                this.process.stderr.on('data', (data: Buffer) => {
                    resolve(this.handleError(`External 7-zip process error. (${this.cleanErrorMessage_7z(data.toString())})`, onProgress, onEnd));
                });

                // handle explicit errors from the process
                this.process.on('error', (error: Error) => {
                    resolve(this.handleError(`External 7-Zip process failed. (${this.cleanErrorMessage_7z(this.getErrorMessage(error))})`, onProgress, onEnd));
                });

                // handle closing the process
                this.process.on('close', (code: number) => {
                    // success
                    if (code === 0) {
                        // update our filenames to be full paths and resolve
                        listResult.files.forEach(file=>{ file.filename = `${fullTargetPath}\\${file.filename}`});
                        resolve(this.handleSuccess(`Unpacked '${srcFilename}' to '${targetPath}'.`, listResult.files, onProgress, onEnd));
                    } else {
                        resolve(this.handleError(`Decompression failed with code (${this.getExitCode_7z(code)})`, onProgress, onEnd));
                    }
                });

            } catch(error) {
                resolve(this.handleError(`failed to create external 7-zip process. (${this.getErrorMessage(error)})`, onProgress, onEnd));
            }
        });
    }

    async compress(sourceFiles: string[], archivePath: string,  onProgress?: ProgressCallback | null, onEnd?: EndCallback | null ): Promise<ArchiveOpResult>  {
        // TODO: accept a directory, single file, or list of files
        let progress: number = 0;
        this.lastMessage = '';

        // make sure our operation matches how we were created
        if(this.activeOp !== ArchiveOpType.UNDEFINED)
            return this.getResult(false, `Cannot compress '${sourceFiles}'. A ${ArchiveOpType[this.activeOp]} operation is already running.`, ArchiveOpType.DECOMPRESS);

        // signal that we're about to do work
        this.status = ProcessStatus.PENDING;
        this.lastMessage = 'Verifying parameters for archive operation';

        // create our external process using 'spawn' so we can get the stdio/progress
        // using 'resolve' for all returns since our return object holds if an error is present or not
        return new Promise(async (resolve)=> {
            try {                              
                // update sourcefiles to make sure they are absolute paths
                sourceFiles = [ ...sourceFiles.map(file => { return this.cleanPath(path.resolve(file)); }) ];
                const fullArchivePath: string = path.resolve(archivePath);

                // verify all source files exist. if not, fail
                const failedFiles: string[] = [];
                for(let i=0; i<sourceFiles.length; i++) {
                    if(await this.canAccessFile(sourceFiles[i]) === false)
                        failedFiles.push(path.basename(sourceFiles[i]));
                }
                if(failedFiles.length>0)
                    resolve(this.handleError(`cannot create archive. some files cannot be found: ${failedFiles.join(',')}`));

                // check if target archive already exists (always overwrite)
                // if not, then we try to create the directory
                const srcFilename: string = path.basename(archivePath);
                if(await this.canAccessFile(fullArchivePath) === true) {
                    onProgress?.(0,`archive found. overwiting: ${path.basename(archivePath)}`);
                } else {
                    // extract our path from where we want to save the archive
                    // check if it we can get there, or create it
                    const basePath: string = path.dirname(fullArchivePath);
                    const {success: dstSuccess, message: dstMessage} = await this.ensureDirectoryExists(basePath);
                    if(dstSuccess===false)
                        resolve(this.handleError(`cannot get directory for archive. ${dstMessage}`, onProgress, onEnd));
                }

                // update status and state
                progress = 0;
                this.lastMessage = '';
                this.activeOp = ArchiveOpType.COMPRESS;
                this.status = ProcessStatus.RUNNING;
                this.lastMessage = `Compressing '${sourceFiles}' to '${archivePath}'`;
                this.startTime = Date.now();

                // set 7-zip switches
                // bsp1: redireect progress to stdout
                // bso0: disable standard messages
                // bse1: send errors to stdout too to avoid default printing of stacktrace (optional)
                const command = '7z';                
                const args = ['a', fullArchivePath, ...sourceFiles, '-bsp1', '-bso0', '-mx1' ];

                // set child_process 'spawn' options handling where to send stdio messages
                // stdin: ignore | stdout: pipe | stderr: pipe
                const options: CommonSpawnOptions = { shell:true , stdio: ['pipe','pipe','pipe'] };
                this.process = spawn(command, args, options)  as ChildProcessWithoutNullStreams;
                
                // handle our progress updates
                this.process.stdout.on('data', (data: Buffer) => {

                    // if we're in an invalid state just return
                    if(this.status <= 0)
                        return; 

                    const message = data.toString();
                    const progressMatch = message.match(/(\d+)%/);
                    if (progressMatch) {
                        progress = parseInt(progressMatch[1], 10);
                    }

                    // avoid duplicate updates and messages
                    const newMessage = `compressing '${srcFilename}'...${progress}%`;
                    if(newMessage!=this.lastMessage) {
                        this.lastMessage = newMessage;
                        onProgress?.(progress, this.lastMessage);
                    }
                });

                // handle stdio errors from the process
                this.process.stderr.on('data', (data: Buffer) => {
                    resolve(this.handleError(`External 7-zip process error. (${this.cleanErrorMessage_7z(data.toString())})`, onProgress, onEnd));
                });

                // handle explicit errors from the process
                this.process.on('error', (error: Error) => {
                    resolve(this.handleError(`External 7-Zip process failed. (${this.cleanErrorMessage_7z(this.getErrorMessage(error))})`, onProgress, onEnd));
                });

                // handle closing the process
                this.process.on('close', (code: number) => {
                    // success
                    if (code === 0) {
                        // get our archive's stats and build a file info to return when resolving
                        const archiveStats = statSync(fullArchivePath);
                        const createdArchive: FileInfo = { date: archiveStats.mtime, filename: this.cleanPath(fullArchivePath), size: archiveStats.size }
                        const sourceFileText: string = (sourceFiles.length>1)?`${sourceFiles.length} files from '${this.cleanPath(path.dirname(sourceFiles[0]))}'`:`'${path.basename(sourceFiles[0])}'`;
                        resolve(this.handleSuccess(`Archived ${sourceFileText} to: ${this.cleanPath(archivePath)}`, [ createdArchive ], onProgress, onEnd));
                    } else {
                        resolve(this.handleError(`Compression failed with code (${this.getExitCode_7z(code)})`, onProgress, onEnd));
                    }
                });

            } catch(error) {
                resolve(this.handleError(`failed to create external 7-zip process. (${this.getErrorMessage(error)})`, onProgress, onEnd));
            }
        });
    }

    async listEntries(archivePath: string, onEnd?: EndCallback | null): Promise<ArchiveOpResult> {
        this.lastMessage = '';

        // cleanup our path
        archivePath = this.cleanPath(archivePath);

        // make sure our operation matches how we were created
        if(this.activeOp !== ArchiveOpType.UNDEFINED)
            return this.getResult(false, `Cannot list entries in '${archivePath}'. A ${ArchiveOpType[this.activeOp]} operation is already running.`, ArchiveOpType.DECOMPRESS);
        this.activeOp = ArchiveOpType.LIST;

        // signal that we're about to do work
        this.status = ProcessStatus.PENDING;
        this.lastMessage = 'Verifying parameters for archive operation';
        this.startTime = Date.now();

        return new Promise(async (resolve)=>{
            try {
                // make sure we have absolute paths
                const fullArchivePath: string = this.cleanPath(path.resolve(archivePath));
                
                // verify our archive path
                const srcFilename: string = path.basename(archivePath);
                const {success: srcSuccess, message: srcMessage} = await this.verifyArchive(fullArchivePath);
                if(srcSuccess===false)
                    resolve(this.handleError(srcMessage,null,onEnd));

                // update our state
                this.status = ProcessStatus.RUNNING;
                this.lastMessage = 'Listing archive contents...';
                this.startTime = Date.now();

                // set 7-zip switches
                // bsp1: redireect progress to stdout
                // bso0: disable standard messages
                // bse1: send errors to stdout too to avoid default printing of stacktrace (optional)
                //   ba: removes header information and table formatting making it easier to parse
                const command = '7z';                
                const args = ['l', '-bsp1', '-bso0', '-ba', fullArchivePath];

                // set child_process 'spawn' options handling where to send stdio messages
                // stdin: ignore | stdout: pipe | stderr: pipe
                const options: CommonSpawnOptions = { shell:true , stdio: ['pipe','pipe','pipe'] };
                this.process = spawn(command, args, options)  as ChildProcessWithoutNullStreams;
                
                // handle our files being listed to stdout
                let entryList: string = '';
                this.process.stdout.on('data', (data: Buffer) => {
                    // if we're in an invalid state just return
                    if(this.status <= 0)
                        return; 

                    // get the string and don't process it unless it starts with a date/numbers
                    const str = data.toString();
                    if(str.startsWith(' ') || str.length<=0)
                        return;

                    // remove all \r and whitespace for aclean line
                    entryList += str.replace(/\r/g,'').trimStart();
                    this.lastMessage = 'Inspecting archive...';
                });

                // handle stdio errors from the process
                this.process.stderr.on('data', (data: Buffer) => {
                    resolve(this.handleError(`External 7-zip process error. (${this.cleanErrorMessage_7z(data.toString())})`,null,onEnd));
                });

                // handle explicit errors from the process
                this.process.on('error', (error: Error) => {
                    resolve(this.handleError(`External 7-Zip process failed. (${this.cleanErrorMessage_7z(this.getErrorMessage(error))})`,null,onEnd));
                });

                // handle closing the process
                this.process.on('close', (code: number) => {
                    // success
                    if (code === 0) {
                        resolve(this.handleSuccess(`Listed contents of '${srcFilename}'.`, this.parseFileList_7z(entryList),null,onEnd));
                    } else {
                        resolve(this.handleError(`Listing contents failed with code (${this.getExitCode_7z(code)})`,null,onEnd));
                    }
                });

            } catch(error) {
                resolve(this.handleError(`failed to create external 7-zip process. (${this.getErrorMessage(error)})`,null,onEnd));
            }
        });
    }

    getStatus() : { status: ProcessStatus, message: string }  {
        // used if not waiting for an op and want the current status
        return { status: this.status, message: this.lastMessage };
    }

    // utility routines
    private async verifyArchive(archivePath:string): Promise<{ success:boolean, message:string }> {
        const acceptedExtensions = ['.zip', '.7z', '.rar'];

        try {
            // Check if the file exists
            await fs.access(archivePath);
    
            // Get the file extension
            const fileExtension = path.extname(archivePath).toLowerCase();
    
            // Check if the extension is in the list of accepted extensions
            if(!acceptedExtensions.includes(fileExtension))
                throw new Error(`unsupported file extension: ${fileExtension}`);
            else
                return { success: true, message: `'${archivePath}' was found and is valid.` };
        } catch (error) {
            // If there is an error (e.g., file does not exist), return false
            return { success: false, message: this.getErrorMessage(error) };
        }
    }
    private async ensureDirectoryExists(directoryPath: string, doCreate: boolean = true): Promise<{ success: boolean, message: string }> {
        try {
            // try to access directly or throw error if it fails
            await fs.access(directoryPath);
            return { success: true, message: 'Directory exists' };
        } catch (accessError) {

            // if we don't want to ccreate the directory then we fail
            if(!doCreate)
                return { success: false, message: `Cannot access directory: ${this.getErrorMessage(accessError)}`};

            // if we want to create the directory, try it
            try {
                await fs.mkdir(directoryPath, { recursive: true });
                return { success: true, message: `Directory did not exist and was created successfully. (${directoryPath})` };
            } catch (mkdirError) {
                return { success: false, message: `Failed to create directory: ${this.getErrorMessage(mkdirError)}` };
            }
        }
    }
    private async canAccessFile(fullPath: string): Promise<boolean> {
        try { 
            await fs.access(fullPath);
            return true;
        } catch(error) { 
            return false; }
    }
    private cleanPath(input: string): string {
        // Use replace with a regular expression to replace double backslashes with single backslashes
        return input.replace(/\\\\|\\|\/\/|\/\\/g, '/');
    }

    // cleanup and handling success/error outcomes
    private cleanup() {
        this.activeOp = ArchiveOpType.UNDEFINED;

        if (this.process && !this.process.killed) {
            this.process.kill();
            this.process = null;
        }
    }
    private handleError(error: string, onProgress?:ProgressCallback | null, onEnd?:EndCallback | null): ArchiveOpResult {
        const result: ArchiveOpResult = this.getResult(false, `${error}`);

        // Set internal status
        this.status = ProcessStatus.ERROR;
        this.lastMessage = result.message;

        // Share via the callbacks
        onProgress?.(100, result.message);
        onEnd?.(result);
        this.cleanup();

        // Exit the promise
        return result;
    }
    private handleSuccess(message: string, files?:FileInfo[], onProgress?:ProgressCallback | null, onEnd?:EndCallback | null): ArchiveOpResult {
        const result = this.getResult(true, message);
        
        if(files)
            result.files = [...files];

        this.status = ProcessStatus.SUCCESS;
        this.lastMessage = result.message;

        onProgress?.(100, result.message);
        onEnd?.(result);
        this.cleanup();

        return result;
    }
    private getResult(success:boolean, message: string, type?: ArchiveOpType ): ArchiveOpResult {
        const elapsedTime = (Date.now() - this.startTime)/1000;
        return { type: type??this.activeOp, runtime: elapsedTime, success, message, files: [] };
    }

    private getErrorMessage(error:any): string {
        let errorMessage = 'An unknown error occurred';
        if (error instanceof Error) {
            errorMessage = error.message;
        }
        return errorMessage;
    }

    // 7-Zip specific utilities
    private parseFileList_7z(rawFileList: string): FileInfo[] {
        // split by line and remove any that are empty
        const lines = rawFileList.split('\n').filter(line => line.trim() !== '');
        const fileInfos: FileInfo[] = [];

        // cycle through lines parse for our critical information, skipping any with '-------'
        // becuase those are from 7-z tables
        for (const line of lines) {
            if (line.trim() && !line.startsWith('---------')) {
                const fileInfo = this.parseFileInfoLine_7z(line);
                if (fileInfo) {
                    fileInfos.push(fileInfo);
                }
            }
        }
        return fileInfos;
    }
    private parseFileInfoLine_7z(line: string): FileInfo | null {
        const regex = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \S+\s+(\d+)\s+\d+\s+(.+)$/;
        const match = line.match(regex);

        // format our date, size, and filename
        if (match) {
            const [, dateStr, timeStr, size, filename] = match;
            const date = new Date(`${dateStr}T${timeStr}`);
            return {
                date,
                size: parseInt(size, 10),
                filename,
            };
        }
    
        return null;
    }
    private cleanErrorMessage_7z(errorString:string): string {
        // list of 7-zip errors and a clean response
        const errorChecks: { substrings: string[], response: string }[] = [
            { substrings: ['Is not archive'], response: 'Is not an archive' },
            { substrings: ['Headers Errror','Unconfirmed start of archive'], response: 'Invalid or corrupt archive' },
        ];

        // cycle through list of errors returning the correct response
        for (const check of errorChecks) {
            for (const substring of check.substrings) {
                if (errorString.includes(substring)) {
                    return check.response;
                }
            }
        }
        return `Unsupported error: ${errorString}`;  
    }
    private getExitCode_7z(code:number): string {
        switch(code) {
            case 0: return 'no error';
            case 1: return 'warning';
            case 2: return 'fatal error';
            case 7: return 'command line error';
            case 8: return 'out of memory';
            case 255: return 'user aborted';
            default: return `unsupported error code (${code})`;
        }
    }
};