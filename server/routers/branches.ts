import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getAllBranches, getBranchById, createBranch, updateBranch, deleteBranch } from "../db";
import { toPlainObject } from "../_core/serialize";

export const branchesRouter = router({
  list: protectedProcedure.query(async () => {
    const branches = await getAllBranches();
    return toPlainObject(branches);
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const branch = await getBranchById(input.id);
      if (!branch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Branch not found" });
      }
      return toPlainObject(branch);
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string(),
        address: z.string().optional(),
        phone: z.string().optional(),
        isMainWarehouse: z.number().default(0),
        status: z.enum(["active", "inactive"]).default("active"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const result = await createBranch(input);
      return toPlainObject(result);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        address: z.string().optional(),
        phone: z.string().optional(),
        isMainWarehouse: z.number().optional(),
        status: z.enum(["active", "inactive"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      
      const { id, ...data } = input;
      const result = await updateBranch(id, data);
      return result;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      try {
        const result = await deleteBranch(input.id);
        return result;
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message || "Error al eliminar sucursal" });
      }
    }),
});
