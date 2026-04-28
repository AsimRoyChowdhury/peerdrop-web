import { Zip, ZipPassThrough } from 'fflate';

export async function zipFolder(
  files: FileList,
  onProgress: (percentage: number) => void
): Promise<File> {
  return new Promise(async (resolve, reject) => {
    let writable: any = null;

    try {
      const folderName = files[0].webkitRelativePath.split('/')[0] || "Shared_Folder";
      const totalSize = Array.from(files).reduce((acc, file) => acc + file.size, 0);
      let processedSize = 0;

      // 1. Access the Browser's Hidden Hard Drive (OPFS)
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(`${folderName}.zip`, { create: true });
      writable = await (fileHandle as any).createWritable();

      // 2. THE FIX: The Backpressure Promise Queue
      // This will hold the chain of disk-write operations
      let writeQueue = Promise.resolve();

      // 3. Setup the Zip Engine
      const zip = new Zip((err, data, final) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Chain the new write operation onto the end of the queue.
        // This ensures writes happen sequentially and allows us to "await" them.
        writeQueue = writeQueue.then(async () => {
          await writable.write(data);
        });
      });

      // 4. Process files sequentially
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = file.webkitRelativePath || file.name;
        
        const fileStream = new ZipPassThrough(path);
        zip.add(fileStream);

        // Read the file off the user's hard drive in tiny chunks
        const reader = file.stream().getReader();
        
        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            fileStream.push(new Uint8Array(0), true); // 'true' signals EOF
            // Wait for EOF markers to write to disk
            await writeQueue;
            break;
          }
          
          // Push the chunk into the compression engine
          fileStream.push(value);
          
          // CRITICAL: THE BACKPRESSURE LOCK
          // Pause the `while` loop! Do not read the next chunk into RAM
          // until the OPFS disk has successfully finished writing this one.
          await writeQueue;
          
          // Update the UI Progress Bar
          processedSize += value.length;
          const progress = totalSize === 0 ? 100 : Math.round((processedSize / totalSize) * 100);
          onProgress(progress);
        }
      }
      
      // Tell the zip engine there are no more files coming
      zip.end();
      
      // Wait for the final Central Directory headers to be written
      await writeQueue;
      
      // Safely close the disk pipeline
      await writable.close();
      writable = null; // Mark as closed
      
      // Retrieve the disk-backed File object
      const finalFile = await fileHandle.getFile(); 
      resolve(finalFile);

    } catch (error) {
      // Emergency Cleanup: If an error happens, close the file handle so it doesn't corrupt OPFS
      if (writable) {
        try { await writable.close(); } catch (_) {}
      }
      console.error("Compression Pipeline Error:", error);
      reject(error);
    }
  });
}