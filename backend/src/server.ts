import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import { ApiError } from './api-error.js';
import { adminRouter } from './admin.js';
import { authRouter } from './auth.js';
import { xatlovRouter } from './xatlov.js';
import { mkdRouter } from './mkd.js';
import { radLimitRouter } from './rad-limits.js';
import { overdueApplicationsRouter } from './overdue-applications.js';
import { dashboardRouter } from './dashboard.js';
import { callLogRouter } from './call-log.js';
import { reportRouter } from './report.js';
import { assignmentsRouter } from './assignments.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/xatlov', xatlovRouter);
app.use('/api/mkd', mkdRouter);
app.use('/api/rad-limits', radLimitRouter);
app.use('/api/overdue-applications', overdueApplicationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/call-log', callLogRouter);
app.use('/api/report', reportRouter);
app.use('/api/assignments', assignmentsRouter);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.use('/api', (_request, response) => {
  response.status(404).json({
    error: { code: 'NOT_FOUND', message: 'API endpoint not found' },
  });
});

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  ) {
    const apiError = new ApiError(400, 'INVALID_JSON', 'Request body must contain valid JSON');
    response.status(apiError.statusCode).json({
      error: { code: apiError.code, message: apiError.message },
    });
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  response.status(500).json({
    error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
  });
};

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
