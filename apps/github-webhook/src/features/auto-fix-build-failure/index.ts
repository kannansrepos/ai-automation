import { Router } from 'express';
import { handleBuildFailureCallback } from './auto-fix.controller.js';

const router: Router = Router();

// Define the route for this specific slice
router.post('/failure/callback', handleBuildFailureCallback);

export { router as handleBuildFailureCallbackRouter };
