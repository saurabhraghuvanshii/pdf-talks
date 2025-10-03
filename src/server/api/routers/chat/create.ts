import { z } from "zod";

import {
  createTRPCRouter,
  protectedProcedure,
} from "@/server/api/trpc";
import { base64ToFile } from "@/lib/utils";
import { processAndEmbedFile } from "./helper";

export const chatRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const chats = await ctx.db.chat.findMany({
      where: {
        userId: ctx.session.user.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            messages: true,
          },
        },
      },
    });

    return chats;
  }),

  create: protectedProcedure
    .input(z.object({ title: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.chat.create({
        data: {
          title: input.title,
          userId: ctx.session.user.id,
        },
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const chat = await ctx.db.chat.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            select: {
              id: true,
              content: true,
              role: true,
              createdAt: true,
              messageFiles: {
                include: {
                  file: true
                }
              },
              messageSources: {
                include: {
                  file: true
                }
              },
            },
          },
        },
      });

      if (!chat) {
        throw new Error('Chat not found');
      }
      return chat;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.chat.delete({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
        },
      });
    }),

  uploadFiles: protectedProcedure
    .input(
      z.object({
        base64Files: z.array(
          z.object({ name: z.string(), type: z.string(), base64: z.string() })
        ),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const files = input.base64Files.map((f) => base64ToFile(f.base64, f.name));

      const uploadedFiles = await Promise.all(
        files.map((file) => processAndEmbedFile(file, ctx.session.user.id))
      );

      return { files: uploadedFiles };
    }),
});
