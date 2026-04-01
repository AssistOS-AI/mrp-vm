import { logger } from '../core/platform/logger.mjs';
import { boot } from '../core/boot/bootstrap.mjs';

const MOD = 'boot';

boot().catch(error => {
  logger.error(MOD, `Fatal boot error: ${error.message}`, { stack: error.stack });
  process.exit(1);
});
