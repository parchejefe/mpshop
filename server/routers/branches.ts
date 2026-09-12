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
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden crear sucursales" });
      }
      try {
        const result = await createBranch(input);
        return toPlainObject(result);
      } catch (err: any) {
        console.error("[branches.create] Error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al crear la sucursal",
        });
      }
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
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden modificar sucursales" });
      }
      
      try {
        const { id, ...data } = input;
        const result = await updateBranch(id, data);
        return toPlainObject(result);
      } catch (err: any) {
        console.error("[branches.update] Error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err?.message || "Error al actualizar sucursal",
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Solo los administradores pueden eliminar sucursales" });
      }
      try {
        const result = await deleteBranch(input.id);
        return toPlainObject(result);
      } catch (err: any) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message || "Error al eliminar sucursal" });
      }
    }),
});
