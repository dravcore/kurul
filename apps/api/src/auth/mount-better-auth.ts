import type { INestApplication } from '@nestjs/common';
import { toNodeHandler } from 'better-auth/node';
import type { Request, Response } from 'express';
import { auth } from './auth';
import { isBlockedOrganizationMutation } from './organization-http-firewall';

/** Mount Better Auth on the underlying Express instance (escape hatch from ADR 0004). */
export function mountBetterAuth(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as {
    all: (path: string, handler: (req: Request, res: Response) => void) => void;
  };

  const authHandler = toNodeHandler(auth);

  // Express 5 requires a named wildcard; braces also match the bare `/auth` base.
  expressApp.all('/auth/{*splat}', (req, res) => {
    if (isBlockedOrganizationMutation(req.path)) {
      res.status(403).json({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Organization mutations must use the Nest workspace API (/workspaces).',
      });
      return;
    }
    void authHandler(req, res);
  });
}
