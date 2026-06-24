import type { Request, Response } from 'express';

// Internal Request/Response types specific only to this slice
interface HealthStatusResponse {
  status: 'UP' | 'DOWN';
  timestamp: string;
  uptime: number;
}

export const getHealthStatusHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Business logic lives directly inside the slice
    const healthReport: HealthStatusResponse = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };

    res.status(200).json(healthReport);
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
