import type { AccessDirectory } from '@atlasbi/auth';
import type { IdentityPort, SemanticQuery, SemanticRuntimePort } from '@atlasbi/contracts';
import type { ReportRepository } from '@atlasbi/reports';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from './trpc.ts';

/** The ports the procedures use — never an engine or a provider (docs/21 §3.2). */
export interface RouterServices {
  identity: Pick<IdentityPort, 'verifyIdentityToken'>;
  access: Pick<AccessDirectory, 'resolveSecurityContext' | 'listMemberships'>;
  /** Absent where the semantic layer does not run: Cube runs on the postgres tier only. */
  semantic: SemanticRuntimePort | undefined;
  reports: Pick<ReportRepository, 'listReports' | 'getReport'>;
}

/** `Authorization: Bearer <identity token>` (decision G1); the scheme is case-insensitive. */
const BEARER = /^bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;

/**
 * Only "an object" here: what a query may contain, and which members this person may use, is the
 * semantic runtime's to check — the port validates whatever it receives (build step 5, Phase A).
 */
const semanticQuery = z.custom<SemanticQuery>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
);

/**
 * The procedures of the internal BFF (docs/06 §4). Identity is verified on every call, locally;
 * the security context is resolved per workspace and per call (docs/06 §6.1, step 3) — never kept
 * per user — and handed to the semantic layer as it is.
 */
export function createAppRouter(services: RouterServices) {
  const authenticated = publicProcedure.use(async ({ ctx, next }) => {
    const token = BEARER.exec(ctx.authorization ?? '')?.[1];
    if (token === undefined) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in again.' });
    }
    const identity = await services.identity.verifyIdentityToken(token);
    return next({ ctx: { identity } });
  });

  // Not strict: the procedures below add their own fields to this input.
  const inWorkspace = authenticated
    .input(z.object({ workspaceId: z.uuid() }))
    .use(async ({ ctx, input, next }) => {
      const securityContext = await services.access.resolveSecurityContext(
        ctx.identity,
        input.workspaceId,
      );
      return next({ ctx: { securityContext } });
    });

  const semanticRuntime = (): SemanticRuntimePort => {
    if (services.semantic === undefined) {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'The semantic layer does not run on this deployment.',
      });
    }
    return services.semantic;
  };

  return router({
    session: router({
      /** Who is signed in, and the workspaces of their organization they belong to, with the role. */
      me: authenticated.query(async ({ ctx }) => ({
        userId: ctx.identity.userId,
        organizationId: ctx.identity.organizationId,
        workspaces: await services.access.listMemberships(ctx.identity),
      })),
    }),
    semantic: router({
      /** The measures and dimensions this person may query in this workspace. */
      meta: inWorkspace.query(({ ctx }) => semanticRuntime().describe(ctx.securityContext)),
      /** Data only: never the engine's query, its SQL or the filters it added. */
      query: inWorkspace
        .input(z.object({ query: semanticQuery }))
        .query(({ ctx, input }) => semanticRuntime().query(input.query, ctx.securityContext)),
    }),
    report: router({
      /** The reports of a workspace; any member may read them (docs/20 §3, Viewer mode). */
      list: inWorkspace.query(({ ctx }) =>
        services.reports.listReports(ctx.securityContext.workspaceId),
      ),
      /** A report whole — pages and visuals, never their data: each visual queries its own. */
      get: inWorkspace.input(z.object({ reportId: z.uuid() })).query(async ({ ctx, input }) => {
        const report = await services.reports.getReport(
          ctx.securityContext.workspaceId,
          input.reportId,
        );
        if (report === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found.' });
        }
        return report;
      }),
    }),
  });
}

/** The type the frontend imports (build step 6): end-to-end types without generated code. */
export type AppRouter = ReturnType<typeof createAppRouter>;
