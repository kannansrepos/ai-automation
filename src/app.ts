import express, { type Application } from 'express';
import apiRouter from './routes.js';
import dotenv from 'dotenv';

const app: Application = express();

// Load environment variables from .env file
dotenv.config();

// Global Middleware
app.use(express.json());

app.use('/api', apiRouter);

export default app;
