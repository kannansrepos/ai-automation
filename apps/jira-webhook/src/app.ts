import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from monorepo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import express, { type Application } from 'express';
import apiRouter from './routes.js';

const app: Application = express();

// Global Middleware
app.use(express.json());

app.use('/api', apiRouter);

export default app;
