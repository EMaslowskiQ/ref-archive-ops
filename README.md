# dpo-archive-ops

> **Pre-release / Experimental** - This library is under active development. APIs may change without notice.

TypeScript library for archive operations via 7-zip CLI. Provides async wrappers for compression, decompression, and archive listing with progress callbacks.

## Requirements

- Node.js >= 18.0.0
- 7-zip (`7z` or `7za`) installed and available in system PATH

## Installation

```bash
npm install dpo-archive-ops
```

## Usage

```typescript
import { ArchiveOps } from 'dpo-archive-ops';

const archiver = new ArchiveOps();

// Compress files
await archiver.compress(['./src'], './output.zip', (progress) => {
  console.log(`${progress}%`);
});

// Decompress archive
await archiver.decompress('./output.zip', './extracted');

// List archive contents
const result = await archiver.listEntries('./output.zip');
console.log(result.files);
```

## Supported Formats

- `.zip`
- `.7z`
- `.rar`

## License

ISC
