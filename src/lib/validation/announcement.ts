import { z } from "zod";

export const announcementSchema = z.object({
  title: z.string().trim().min(1, "タイトルは必須です"),
  body: z.string().trim().min(1, "本文は必須です"),
  category: z.enum(["NOTICE", "TECH", "PRICING"]),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;
