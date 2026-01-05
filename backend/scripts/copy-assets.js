import fs from 'fs-extra';
import path from 'path';

(async () => {
  try {
    const src = path.resolve(process.cwd(), 'uploads');
    const dest = path.resolve(process.cwd(), 'dist', 'uploads');

    if (!(await fs.pathExists(src))) {
      console.log('No uploads directory to copy');
      process.exit(0);
    }

    await fs.copy(src, dest, { overwrite: true });
    console.log('Assets copied to', dest);
  } catch (err) {
    console.error('Failed to copy assets:', err);
    process.exit(1);
  }
})();
