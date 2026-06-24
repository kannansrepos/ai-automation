import { Router } from 'express';
import { getHealthStatusHandler } from './get-health-status.controller.js';

const router: Router = Router();

// Define the route for this specific slice
router.get('/health', getHealthStatusHandler);

export { router as getHealthStatusRouter };
