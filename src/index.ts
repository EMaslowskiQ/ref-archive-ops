import { ArchiveOps } from './system/util/archiveOps.ts';
import fs from 'fs';
import path from 'path';

const getFilesToCompress = async (srcPath: string): Promise<string[]> => {

    const srcStats = fs.statSync(srcPath);
    if(srcStats.isFile() === true)
        return [ path.resolve(srcPath) ];

    // if a directory then get all files inside
    const files = await fs.readdirSync(srcPath);
    if(!files || files.length === 0)
        return [];

    const result: string[] = files.map(file => { file = `${srcPath}\\${file}`; return file; });
    return result;
}

const main = async (srcPath: string, dstPath: string) => {  
    const op = new ArchiveOps();
    // const opResult = await op.listEntries(srcPath, (result)=>{ console.log(result); });

    // decompress archive into temp folder
    // const opResult = await op.decompress(srcPath,dstPath, 
    //     (progress, message)=>{ console.log(`${progress?.toString().padStart(3, ' ') ?? -1}: ${message}`); },
    //     (result)=>{ console.log('onEnd:\n',result); });

    // compress and place zip in temp folder
    // NOTE: files to compress need to be valid paths. (absolute preferred) they cannot be just filenames
    const filesToCompress: string[] = await getFilesToCompress(srcPath);
    const opResult = await op.compress(filesToCompress,dstPath+'/test.zip', 
        (progress, message)=>{ console.log(`${progress?.toString().padStart(3, ' ') ?? -1}: ${message}`); },
        (result)=>{ console.log('onEnd:\n',result); });
};

const sourcePath = process.argv[2];
const tempDir = fs.mkdtempSync(path.join('./tmp', 'compressed-'));
main(sourcePath,tempDir);